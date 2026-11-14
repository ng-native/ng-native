#include "ngn/camera.h"

#include "ngn/bytes.h"
#include "ngn/crypto.h"
#include "ngn/desktop-view-props.h"
#include "ngn/file-system.h"

#include <react/renderer/core/propsConversions.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <random>

using namespace facebook::react;

namespace ngn {

const char CameraComponentName[] = "ViewManagerAdapter_ExpoCamera";

CameraProps::CameraProps(const PropsParserContext &context, const CameraProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      facing(convertRawProp(context, rawProps, "facing", sourceProps.facing, std::string{"back"})),
      active(convertRawProp(context, rawProps, "active", sourceProps.active, true)),
      mirror(convertRawProp(context, rawProps, "mirror", sourceProps.mirror, false)) {}

void CameraViews::attach(int tag, std::shared_ptr<CameraCapture> capture) {
  std::lock_guard lock(mutex_);
  captures_[tag] = std::move(capture);
}

void CameraViews::detach(int tag) {
  std::lock_guard lock(mutex_);
  captures_.erase(tag);
}

std::shared_ptr<CameraCapture> CameraViews::find(int tag) const {
  std::lock_guard lock(mutex_);
  auto found = captures_.find(tag);
  return found == captures_.end() ? nullptr : found->second;
}

CameraMount cameraMount(CameraHardware::Access access, bool hasCamera, bool noPrompts) {
  using Access = CameraHardware::Access;
  if (access == Access::NotDetermined && !noPrompts) {
    return CameraMount::Ask;
  }
  if (access != Access::Granted) {
    return CameraMount::NotPermitted;
  }
  return hasCamera ? CameraMount::Start : CameraMount::NoCamera;
}

std::string cameraMountError(CameraMount mount) {
  switch (mount) {
    case CameraMount::NotPermitted:
      return "Camera permissions not granted - component could not be rendered.";
    case CameraMount::NoCamera:
      return "Camera could not be started - this Mac has no camera.";
    default:
      return "";
  }
}

namespace {

folly::dynamic permissionOf(CameraHardware::Access access) {
  using Access = CameraHardware::Access;
  const char *status = access == Access::Granted ? "granted" : access == Access::NotDetermined ? "undetermined" : "denied";
  return folly::dynamic::object("status", status)("granted", access == Access::Granted)("canAskAgain", access == Access::NotDetermined)(
      "expires", "never");
}

std::string newJpegName() {
  static std::mutex mutex;
  static std::random_device device;
  std::lock_guard lock(mutex);
  std::string bytes(16, '\0');
  for (auto &byte : bytes) {
    byte = static_cast<char>(device() & 0xff);
  }
  auto id = uuidV4(bytes);
  std::transform(id.begin(), id.end(), id.begin(), [](unsigned char c) { return std::toupper(c); });
  return id + ".jpg";
}

std::string contentsOf(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), {}};
}

} // namespace

std::shared_ptr<NativeModule> makeCameraModule(
    std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts) {
  struct Camera : NativeModule {
    Camera(std::shared_ptr<CameraHardware> hardware, std::shared_ptr<CameraViews> views, std::string pictures, bool noPrompts)
        : NativeModule("NgNativeCamera") {
      using Access = CameraHardware::Access;
      promise("getCameraPermissionsAsync", [hardware](const folly::dynamic &, JsPromise promise) {
        promise.resolve(permissionOf(hardware->access()));
      });
      promise("requestCameraPermissionsAsync", [hardware, noPrompts](const folly::dynamic &, JsPromise promise) {
        auto access = hardware->access();
        if (noPrompts || access != Access::NotDetermined) {
          promise.resolve(permissionOf(access));
          return;
        }
        hardware->requestAccess([promise](Access decided) { promise.resolve(permissionOf(decided)); });
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
        double quality = 1;
        bool base64 = false;
        if (options.isObject()) {
          if (const auto *q = options.get_ptr("quality"); q && q->isNumber()) {
            quality = std::clamp(q->asDouble(), 0.0, 1.0);
          }
          if (const auto *b = options.get_ptr("base64"); b && b->isBool()) {
            base64 = b->asBool();
          }
        }
        std::error_code ignored;
        std::filesystem::create_directories(pictures, ignored);
        auto path = pictures + "/" + newJpegName();
        capture->takePicture(quality, path, [promise, path, base64](int width, int height, const std::string &error) {
          if (!error.empty()) {
            promise.reject("Camera.takePicture: " + error);
            return;
          }
          folly::dynamic picture = folly::dynamic::object("uri", fileUri(path))("width", width)("height", height)("format", "jpg");
          if (base64) {
            picture["base64"] = base64Encode(contentsOf(path));
          }
          promise.resolve(std::move(picture));
        });
      });
      promise("record", [](const folly::dynamic &, JsPromise promise) { promise.reject("Camera.record: macOS does not record video yet"); });
      promise("stopRecording", [](const folly::dynamic &, JsPromise promise) { promise.resolve(nullptr); });
    }
  };
  return std::make_shared<Camera>(std::move(hardware), std::move(views), std::move(pictures), noPrompts);
}

} // namespace ngn
