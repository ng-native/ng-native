#include "ngn/camera.h"

#include "ngn/bytes.h"
#include "ngn/crypto.h"
#include "ngn/desktop-view-props.h"
#include "ngn/file-system.h"

#include <react/renderer/core/propsConversions.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <random>

using namespace facebook::react;

namespace ngn {

const char CameraComponentName[] = "ViewManagerAdapter_ExpoCamera";

CameraProps::CameraProps(const PropsParserContext &context, const CameraProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      facing(convertRawProp(context, rawProps, "facing", sourceProps.facing, std::string{"back"})),
      active(convertRawProp(context, rawProps, "active", sourceProps.active, true)),
      mirror(convertRawProp(context, rawProps, "mirror", sourceProps.mirror, false)),
      mute(convertRawProp(context, rawProps, "mute", sourceProps.mute, false)) {}

void CameraViews::attach(int tag, std::shared_ptr<CameraCapture> capture) {
  std::lock_guard lock(mutex_);
  captures_[tag] = std::move(capture);
}

void CameraViews::detach(int tag) {
  std::lock_guard lock(mutex_);
  captures_.erase(tag);
  muted_.erase(tag);
}

std::shared_ptr<CameraCapture> CameraViews::find(int tag, bool *muted) const {
  std::lock_guard lock(mutex_);
  if (muted) {
    *muted = muted_.contains(tag);
  }
  auto found = captures_.find(tag);
  return found == captures_.end() ? nullptr : found->second;
}

CameraMount cameraMount(CameraHardware::Access access, bool hasCamera, bool noPrompts, bool asked) {
  using Access = CameraHardware::Access;
  if (access == Access::NotDetermined && !noPrompts && !asked) {
    return CameraMount::Ask;
  }
  if (access != Access::Granted) {
    return CameraMount::NotPermitted;
  }
  return hasCamera ? CameraMount::Start : CameraMount::NoCamera;
}

void CameraViews::mute(int tag, bool muted) {
  std::lock_guard lock(mutex_);
  if (muted) {
    muted_.insert(tag);
  } else {
    muted_.erase(tag);
  }
}

bool CameraViews::muted(int tag) const {
  std::lock_guard lock(mutex_);
  return muted_.contains(tag);
}

int chooseCamera(const std::vector<CameraCandidate> &cameras) {
  int other = -1;
  for (size_t i = 0; i < cameras.size(); i++) {
    if (cameras[i].suspended) {
      continue;
    }
    if (cameras[i].builtIn) {
      return static_cast<int>(i);
    }
    other = other < 0 ? static_cast<int>(i) : other;
  }
  return other;
}

std::string cameraMountError(CameraMount mount) {
  switch (mount) {
    case CameraMount::NotPermitted:
      return "Camera permissions not granted - component could not be rendered.";
    case CameraMount::NoCamera:
      return "Camera could not be started - this computer has no camera.";
    default:
      return "";
  }
}

folly::dynamic cameraPermissionOf(CameraHardware::Access access) {
  using Access = CameraHardware::Access;
  const char *status = access == Access::Granted ? "granted" : access == Access::NotDetermined ? "undetermined" : "denied";
  return folly::dynamic::object("status", status)("granted", access == Access::Granted)("canAskAgain", access == Access::NotDetermined)(
      "expires", "never");
}

void requestCameraPermission(CameraHardware &hardware, bool noPrompts, JsPromise promise) {
  auto access = hardware.access();
  if (noPrompts || access != CameraHardware::Access::NotDetermined) {
    promise.resolve(cameraPermissionOf(access));
    return;
  }
  hardware.requestAccess([promise](CameraHardware::Access decided) { promise.resolve(cameraPermissionOf(decided)); });
}

namespace {

// A new file's name: a random UUID with `extension`, as expo names its pictures and videos.
std::string newFileName(const std::string &extension) {
  static std::mutex mutex;
  static std::random_device device;
  std::lock_guard lock(mutex);
  std::string bytes(16, '\0');
  for (auto &byte : bytes) {
    byte = static_cast<char>(device() & 0xff);
  }
  auto id = uuidV4(bytes);
  std::transform(id.begin(), id.end(), id.begin(), [](unsigned char c) { return std::toupper(c); });
  return id + extension;
}

std::string contentsOf(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), {}};
}

} // namespace

MediaKinds mediaKindsOf(const folly::dynamic &options) {
  MediaKinds kinds;
  const auto *types = options.isObject() ? options.get_ptr("mediaTypes") : nullptr;
  auto add = [&kinds](const folly::dynamic &type) {
    if (!type.isString()) {
      return;
    }
    kinds.photos = kinds.photos || type == "images" || type == "livePhotos" || type == "Images" || type == "All";
    kinds.videos = kinds.videos || type == "videos" || type == "Videos" || type == "All";
  };
  if (types != nullptr && types->isArray()) {
    for (const auto &type : *types) {
      add(type);
    }
  } else if (types != nullptr) {
    add(*types);
  }
  kinds.photos = kinds.photos || !kinds.videos;
  return kinds;
}

namespace {

// AVFoundation's session preset for expo-image-picker's videoQuality, which on iOS is
// UIImagePickerController's QualityType; High for any other value.
std::string videoPresetOf(const folly::dynamic &options) {
  const auto *quality = options.isObject() ? options.get_ptr("videoQuality") : nullptr;
  if (quality == nullptr || !quality->isNumber()) {
    return "High";
  }
  static const char *const presets[] = {"High", "Medium", "Low", "640x480", "iFrame1280x720", "iFrame960x540"};
  auto value = quality->asDouble();
  for (size_t i = 0; i < std::size(presets); i++) {
    if (value == static_cast<double>(i)) {
      return presets[i];
    }
  }
  return "High";
}

// Shows the sheet, once the microphone is settled, and answers what it took. A video has sound
// only with the microphone allowed.
void showPickerCamera(const PickerCamera &camera, const folly::dynamic &options, MediaKinds kinds, bool sound, JsPromise promise) {
  CameraSheetRequest request{.photos = kinds.photos, .videos = kinds.videos};
  request.video.sound = sound;
  bool base64 = false;
  bool exif = false;
  if (options.isObject()) {
    if (const auto *q = options.get_ptr("quality"); q && q->isNumber()) {
      request.photo.quality = std::clamp(q->asDouble(), 0.0, 1.0);
    }
    if (const auto *d = options.get_ptr("videoMaxDuration"); d && d->isNumber()) {
      request.video.maxDuration = std::max(0.0, d->asDouble());
    }
    base64 = options.getDefault("base64", false) == true;
    exif = options.getDefault("exif", false) == true;
  }
  request.video.preset = videoPresetOf(options);
  std::error_code ignored;
  std::filesystem::create_directories(camera.folder, ignored);
  request.photo.path = camera.folder + "/" + newFileName(".jpg");
  request.video.path = camera.folder + "/" + newFileName(".mov");
  auto photoPath = request.photo.path;
  auto videoPath = request.video.path;
  camera.sheet->shoot(request, [promise, photoPath, videoPath, base64, exif](CameraTake take, const std::string &error) {
    if (!error.empty()) {
      promise.reject("ImagePicker: " + error);
      return;
    }
    if (!take.photo && !take.video) {
      promise.resolve(folly::dynamic::object("canceled", true)("assets", nullptr));
      return;
    }
    const auto &path = take.video ? videoPath : photoPath;
    std::error_code sizeError;
    auto size = std::filesystem::file_size(path, sizeError);
    folly::dynamic asset = folly::dynamic::object("uri", fileUri(path))("assetId", nullptr)("fileName", nullptr)(
        "fileSize", sizeError ? folly::dynamic(nullptr) : folly::dynamic(static_cast<int64_t>(size)))("exif", nullptr)("base64", nullptr);
    if (take.video) {
      // As iOS answers a recorded video: no EXIF and no base64, whatever was asked.
      asset["type"] = "video";
      asset["width"] = take.video->width;
      asset["height"] = take.video->height;
      asset["mimeType"] = "video/quicktime";
      asset["duration"] = take.video->duration;
    } else {
      asset["type"] = "image";
      asset["width"] = take.photo->width;
      asset["height"] = take.photo->height;
      asset["mimeType"] = "image/jpeg";
      asset["duration"] = nullptr;
      if (exif) {
        asset["exif"] = take.photo->exif;
      }
      if (base64) {
        asset["base64"] = base64Encode(contentsOf(path));
      }
    }
    promise.resolve(folly::dynamic::object("canceled", false)("assets", folly::dynamic::array(std::move(asset))));
  });
}

// iOS's words for a request for videos from an app that cannot ask for the microphone.
constexpr const char *kMissingMicrophone =
    "ImagePicker: Missing microphone permission. Please enable it with the `expo-image-picker` config plugin";

} // namespace

void launchPickerCamera(const PickerCamera &camera, bool noPrompts, const folly::dynamic &options, JsPromise promise) {
  if (camera.hardware->access() != CameraHardware::Access::Granted) {
    promise.reject("ImagePicker: Missing camera or camera roll permission");
    return;
  }
  if (noPrompts) {
    promise.resolve(folly::dynamic::object("canceled", true)("assets", nullptr));
    return;
  }
  if (!camera.hardware->hasCamera()) {
    promise.reject("ImagePicker: this computer has no camera");
    return;
  }
  auto kinds = mediaKindsOf(options);
  if (!kinds.videos) {
    showPickerCamera(camera, options, kinds, false, std::move(promise));
    return;
  }
  // A video's sound, as iOS's camera has it: asked for when undetermined, and a video recorded with
  // no sound when the microphone is refused. Only an app that cannot ask (no
  // NSMicrophoneUsageDescription, so the request leaves it undetermined) is rejected, as iOS
  // rejects it.
  using Access = AudioInput::Access;
  auto access = camera.microphone ? camera.microphone->access() : Access::Denied;
  if (access != Access::NotDetermined) {
    showPickerCamera(camera, options, kinds, access == Access::Granted, std::move(promise));
    return;
  }
  camera.microphone->requestAccess([camera, options, kinds, promise](Access decided) {
    if (decided == Access::NotDetermined) {
      promise.reject(kMissingMicrophone);
      return;
    }
    showPickerCamera(camera, options, kinds, decided == Access::Granted, promise);
  });
}

std::shared_ptr<NativeModule> makeCameraModule(
    std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts) {
  struct Camera : NativeModule {
    Camera(std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts)
        : NativeModule("NgNativeCamera") {
      using Access = CameraHardware::Access;
      promise("getCameraPermissionsAsync", [hardware](const folly::dynamic &, JsPromise promise) {
        promise.resolve(cameraPermissionOf(hardware->access()));
      });
      promise("requestCameraPermissionsAsync", [hardware, noPrompts](const folly::dynamic &, JsPromise promise) {
        requestCameraPermission(*hardware, noPrompts, std::move(promise));
      });
      promise("isAvailableAsync", [hardware](const folly::dynamic &, JsPromise promise) { promise.resolve(hardware->hasCamera()); });
      promise("takePicture", [hardware, views, pictures](const folly::dynamic &args, JsPromise promise) {
        int tag = !args.empty() && args[0].isNumber() ? static_cast<int>(args[0].asDouble()) : -1;
        const folly::dynamic options = args.size() > 1 ? args[1] : folly::dynamic(nullptr);
        if (hardware->access() != Access::Granted) {
          promise.reject("Camera.takePicture: camera permission has not been granted");
          return;
        }
        auto capture = views->find(tag);
        if (!capture) {
          promise.reject("Camera is not ready yet. Wait for 'onCameraReady' callback");
          return;
        }
        CameraPictureRequest request;
        bool base64 = false;
        if (options.isObject()) {
          if (const auto *q = options.get_ptr("quality"); q && q->isNumber()) {
            request.quality = std::clamp(q->asDouble(), 0.0, 1.0);
          }
          if (const auto *b = options.get_ptr("base64"); b && b->isBool()) {
            base64 = b->asBool();
          }
          if (const auto *t = options.get_ptr("imageType"); t && !t->isNull()) {
            if (!t->isString() || (t->asString() != "jpg" && t->asString() != "png")) {
              promise.reject("Camera.takePicture: imageType must be 'jpg' or 'png'");
              return;
            }
            request.format = t->asString();
          }
        }
        std::error_code ignored;
        std::filesystem::create_directories(pictures, ignored);
        request.path = pictures + "/" + newFileName("." + request.format);
        auto path = request.path;
        auto format = request.format;
        capture->takePicture(request, [promise, path, format, base64](int width, int height, const std::string &error) {
          if (!error.empty()) {
            promise.reject("Camera.takePicture: " + error);
            return;
          }
          folly::dynamic picture = folly::dynamic::object("uri", fileUri(path))("width", width)("height", height)("format", format);
          if (base64) {
            picture["base64"] = base64Encode(contentsOf(path));
          }
          promise.resolve(std::move(picture));
        });
      });
      promise("record", [hardware, views, pictures](const folly::dynamic &args, JsPromise promise) {
        int tag = !args.empty() && args[0].isNumber() ? static_cast<int>(args[0].asDouble()) : -1;
        const folly::dynamic options = args.size() > 1 ? args[1] : folly::dynamic(nullptr);
        if (hardware->access() != Access::Granted) {
          promise.reject("Camera.record: camera permission has not been granted");
          return;
        }
        bool muted = false;
        auto capture = views->find(tag, &muted);
        if (!capture) {
          promise.reject("Camera is not ready yet. Wait for 'onCameraReady' callback");
          return;
        }
        if (capture->recording()) {
          promise.reject("Camera.record: a recording is already in progress");
          return;
        }
        CameraRecordingRequest request;
        if (options.isObject()) {
          if (const auto *d = options.get_ptr("maxDuration"); d && d->isNumber()) {
            request.maxDuration = std::max(0.0, d->asDouble());
          }
          if (const auto *f = options.get_ptr("maxFileSize"); f && f->isNumber()) {
            request.maxFileSize = std::max(0.0, f->asDouble());
          }
          if (const auto *c = options.get_ptr("codec"); c && c->isString()) {
            request.codec = c->asString();
          }
        }
        // The view's `mute` prop, as on iOS, where record() takes no `mute`.
        request.sound = !muted && hardware->microphoneAllowed();
        std::error_code ignored;
        std::filesystem::create_directories(pictures, ignored);
        request.path = pictures + "/" + newFileName(".mov");
        capture->startRecording(request, [promise, path = request.path](const std::string &error) {
          if (!error.empty()) {
            promise.reject("Camera.record: " + error);
            return;
          }
          promise.resolve(folly::dynamic::object("uri", fileUri(path)));
        });
      });
      promise("stopRecording", [views](const folly::dynamic &args, JsPromise promise) {
        int tag = !args.empty() && args[0].isNumber() ? static_cast<int>(args[0].asDouble()) : -1;
        if (auto capture = views->find(tag)) {
          capture->stopRecording();
        }
        promise.resolve(nullptr);
      });
    }
  };
  return std::make_shared<Camera>(std::move(hardware), std::move(views), std::move(pictures), noPrompts);
}

} // namespace ngn
