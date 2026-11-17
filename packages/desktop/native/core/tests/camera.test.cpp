#include "ngn/bytes.h"
#include "ngn/camera.h"
#include "ngn/file-system.h"

#include <doctest/doctest.h>
#include <react/renderer/core/PropsParserContext.h>

#include <filesystem>
#include <fstream>
#include <optional>

using folly::dynamic;
using Access = ngn::CameraHardware::Access;

namespace {

struct FakeHardware final : ngn::CameraHardware {
  Access state{Access::NotDetermined};
  bool camera{true};
  int asked{0};
  std::optional<Access> answer;
  Access access() override {
    return state;
  }
  void requestAccess(std::function<void(Access)> done) override {
    asked++;
    if (answer) {
      state = *answer;
    }
    done(state);
  }
  bool hasCamera() override {
    return camera;
  }
  bool microphone{true};
  bool microphoneAllowed() override {
    return microphone;
  }
};

struct FakeCapture final : ngn::CameraCapture {
  std::string error;
  std::string format;
  void takePicture(const ngn::CameraPictureRequest &request, std::function<void(int, int, const std::string &)> done) override {
    if (!error.empty()) {
      done(0, 0, error);
      return;
    }
    format = request.format;
    std::ofstream(request.path, std::ios::binary) << (request.format == "png" ? "PNG" : "JPEG@") << request.quality;
    done(1280, 720, "");
  }
  // The recording in progress, finished by stopRecording.
  std::optional<ngn::CameraRecordingRequest> asked;
  std::function<void(const std::string &)> finish;
  int stops{0};
  void startRecording(const ngn::CameraRecordingRequest &request, std::function<void(const std::string &)> done) override {
    if (!error.empty()) {
      done(error);
      return;
    }
    asked = request;
    finish = std::move(done);
  }
  void stopRecording() override {
    stops++;
    if (finish) {
      std::ofstream(asked->path, std::ios::binary) << "MOV";
      auto done = std::move(finish);
      finish = nullptr;
      done("");
    }
  }
  // Run as record() asks whether a recording runs: between its lookup of the view and the start.
  std::function<void()> whileChecked;
  bool recording() const override {
    if (whileChecked) {
      whileChecked();
    }
    return finish != nullptr;
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer call(const ngn::NativeModule &module, const std::string &method, dynamic args = dynamic::array()) {
  Answer answer;
  module.callWithPromise(method, args, {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-camera-" + std::to_string(rand()));
  ~Folder() {
    std::filesystem::remove_all(path);
  }
};

} // namespace

TEST_CASE("cameraMount asks only when it can, starts only with the camera allowed and present, and says why not") {
  CHECK(ngn::cameraMount(Access::NotDetermined, true, false) == ngn::CameraMount::Ask);
  CHECK(ngn::cameraMount(Access::NotDetermined, true, true) == ngn::CameraMount::NotPermitted);
  // Still undetermined after asking (no usage string, so no prompt): not asked again.
  CHECK(ngn::cameraMount(Access::NotDetermined, true, false, true) == ngn::CameraMount::NotPermitted);
  CHECK(ngn::cameraMount(Access::Granted, true, false, true) == ngn::CameraMount::Start);
  CHECK(ngn::cameraMount(Access::Denied, true, false) == ngn::CameraMount::NotPermitted);
  CHECK(ngn::cameraMount(Access::Restricted, true, false) == ngn::CameraMount::NotPermitted);
  CHECK(ngn::cameraMount(Access::Granted, true, false) == ngn::CameraMount::Start);
  // A Mac with no camera: allowed, and still nothing to start.
  CHECK(ngn::cameraMount(Access::Granted, false, false) == ngn::CameraMount::NoCamera);
  CHECK(ngn::cameraMountError(ngn::CameraMount::NotPermitted) == "Camera permissions not granted - component could not be rendered.");
  CHECK(ngn::cameraMountError(ngn::CameraMount::NoCamera).find("no camera") != std::string::npos);
  CHECK(ngn::cameraMountError(ngn::CameraMount::Start).empty());
}

TEST_CASE("chooseCamera takes the built-in camera unless it is suspended, then any camera that is not") {
  using Camera = ngn::CameraCandidate;
  // A MacBook open, with a virtual camera listed first.
  CHECK(ngn::chooseCamera({Camera{.builtIn = false}, Camera{.builtIn = true}}) == 1);
  // The lid closed: the built-in camera is listed but suspended, and gives no frames.
  CHECK(ngn::chooseCamera({Camera{.builtIn = true, .suspended = true}, Camera{.builtIn = false}}) == 1);
  // Nothing that gives frames: no camera.
  CHECK(ngn::chooseCamera({Camera{.builtIn = true, .suspended = true}}) == -1);
  CHECK(ngn::chooseCamera({}) == -1);
}

TEST_CASE("NgNativeCamera answers the permission in expo's shape, asking only what is undetermined, never with no prompts") {
  auto hardware = std::make_shared<FakeHardware>();
  auto quiet = ngn::makeCameraModule(hardware, std::make_shared<ngn::CameraViews>(), "/tmp/unused", true);
  CHECK(call(*quiet, "requestCameraPermissionsAsync").value ==
        dynamic(dynamic::object("status", "undetermined")("granted", false)("canAskAgain", true)("expires", "never")));
  CHECK(hardware->asked == 0);

  auto module = ngn::makeCameraModule(hardware, std::make_shared<ngn::CameraViews>(), "/tmp/unused", false);
  hardware->answer = Access::Denied;
  CHECK((*call(*module, "requestCameraPermissionsAsync").value)["status"] == "denied");
  CHECK(hardware->asked == 1);
  CHECK((*call(*module, "requestCameraPermissionsAsync").value)["canAskAgain"] == false);
  CHECK(hardware->asked == 1);
  CHECK((*call(*module, "getCameraPermissionsAsync").value)["granted"] == false);

  hardware->camera = false;
  CHECK(call(*module, "isAvailableAsync").value == dynamic(false));
}

TEST_CASE("NgNativeCamera takes a picture from a running view by its tag, into the pictures folder") {
  Folder folder;
  auto hardware = std::make_shared<FakeHardware>();
  auto views = std::make_shared<ngn::CameraViews>();
  auto module = ngn::makeCameraModule(hardware, views, folder.path.string(), false);
  // Denied, nothing is taken, even from a running view.
  auto capture = std::make_shared<FakeCapture>();
  views->attach(7, capture);
  hardware->state = Access::Denied;
  CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object())).error == "Camera.takePicture: camera permission has not been granted");

  hardware->state = Access::Granted;
  auto picture = call(*module, "takePicture", dynamic::array(7, dynamic::object("quality", 0.5)("base64", true)));
  REQUIRE(picture.value);
  auto uri = (*picture.value)["uri"].asString();
  CHECK(uri.rfind("file://" + folder.path.string() + "/", 0) == 0);
  CHECK((*picture.value)["width"] == 1280);
  CHECK((*picture.value)["height"] == 720);
  CHECK((*picture.value)["format"] == "jpg");
  CHECK(uri.ends_with(".jpg"));
  CHECK(capture->format == "jpg");
  CHECK((*picture.value)["base64"] == ngn::base64Encode("JPEG@0.5"));

  CHECK(call(*module, "takePicture", dynamic::array(8, dynamic::object())).error == "Camera is not ready yet. Wait for 'onCameraReady' callback");
  views->detach(7);
  CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object())).error);
  views->attach(7, capture);
  capture->error = "the session stopped";
  CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object())).error == "Camera.takePicture: the session stopped");
}

TEST_CASE("NgNativeCamera takes a picture as a PNG or a JPEG, as expo-camera's imageType asks, and refuses another") {
  Folder folder;
  auto hardware = std::make_shared<FakeHardware>();
  hardware->state = Access::Granted;
  auto views = std::make_shared<ngn::CameraViews>();
  auto module = ngn::makeCameraModule(hardware, views, folder.path.string(), false);
  auto capture = std::make_shared<FakeCapture>();
  views->attach(7, capture);

  auto png = call(*module, "takePicture", dynamic::array(7, dynamic::object("imageType", "png")("quality", 0.3)));
  REQUIRE(png.value);
  CHECK((*png.value)["format"] == "png");
  CHECK((*png.value)["uri"].asString().ends_with(".png"));
  CHECK(capture->format == "png");
  CHECK(std::filesystem::exists(ngn::pathOfUri((*png.value)["uri"].asString()).value()));

  auto jpg = call(*module, "takePicture", dynamic::array(7, dynamic::object("imageType", "jpg")));
  REQUIRE(jpg.value);
  CHECK((*jpg.value)["format"] == "jpg");
  CHECK((*jpg.value)["uri"].asString().ends_with(".jpg"));
  CHECK(capture->format == "jpg");

  // expo-camera's PictureFormat has jpg and png only: iOS refuses any other value as it converts it.
  capture->format.clear();
  for (auto other : {"heic", "jpeg", "PNG"}) {
    CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object("imageType", other))).error ==
          "Camera.takePicture: imageType must be 'jpg' or 'png'");
  }
  CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object("imageType", 3))).error);
  CHECK(capture->format.empty());
}

TEST_CASE("NgNativeCamera records a movie from a running view until it is stopped, into the same folder") {
  Folder folder;
  auto hardware = std::make_shared<FakeHardware>();
  hardware->state = Access::Granted;
  auto views = std::make_shared<ngn::CameraViews>();
  auto module = ngn::makeCameraModule(hardware, views, folder.path.string(), false);
  auto capture = std::make_shared<FakeCapture>();
  views->attach(7, capture);

  Answer answer;
  module->callWithPromise(
      "record", dynamic::array(7, dynamic::object("maxDuration", 30)("maxFileSize", 5000000)("codec", "hvc1")),
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  // Still recording: nothing answered yet.
  CHECK_FALSE(answer.value);
  CHECK_FALSE(answer.error);
  REQUIRE(capture->asked);
  CHECK(capture->asked->maxDuration == 30);
  CHECK(capture->asked->maxFileSize == 5000000);
  CHECK(capture->asked->codec == "hvc1");
  CHECK(capture->asked->sound);
  CHECK(capture->asked->path.rfind(folder.path.string() + "/", 0) == 0);
  CHECK(capture->asked->path.ends_with(".mov"));
  // One at a time.
  CHECK(call(*module, "record", dynamic::array(7, dynamic::object())).error == "Camera.record: a recording is already in progress");

  CHECK(call(*module, "stopRecording", dynamic::array(7)).value == dynamic(nullptr));
  REQUIRE(answer.value);
  CHECK((*answer.value)["uri"] == dynamic(ngn::fileUri(capture->asked->path)));
  CHECK(std::filesystem::exists(capture->asked->path));
  // Stopping a view that is not recording, or not there, does nothing.
  CHECK(call(*module, "stopRecording", dynamic::array(7)).value == dynamic(nullptr));
  CHECK(call(*module, "stopRecording", dynamic::array(9)).value == dynamic(nullptr));
}

TEST_CASE("NgNativeCamera records without sound when the view has mute or without the microphone, and never asks for it") {
  Folder folder;
  auto hardware = std::make_shared<FakeHardware>();
  hardware->state = Access::Granted;
  auto views = std::make_shared<ngn::CameraViews>();
  auto module = ngn::makeCameraModule(hardware, views, folder.path.string(), false);
  auto capture = std::make_shared<FakeCapture>();
  views->attach(7, capture);
  auto start = [&](dynamic options) {
    capture->asked.reset();
    module->callWithPromise("record", dynamic::array(7, options), {.resolve = [](dynamic) {}, .reject = [](const std::string &) {}});
    REQUIRE(capture->asked);
    return capture->asked->sound;
  };
  auto record = [&](dynamic options) {
    bool sound = start(options);
    capture->stopRecording();
    return sound;
  };
  // The view's mute, set before the recording.
  views->mute(7, true);
  CHECK_FALSE(record(dynamic::object()));
  // As on iOS, the view's mute is the only one: record() takes none of its own, either way.
  CHECK_FALSE(record(dynamic::object("mute", false)));
  // The prop taken off, the next recording has sound.
  views->mute(7, false);
  CHECK(record(dynamic::object()));
  CHECK(record(dynamic::object("mute", true)));
  // Another view's mute is its own.
  views->mute(8, true);
  CHECK(record(dynamic::object()));
  // A view muted while it records: that recording keeps the sound it started with, the next has none.
  CHECK(start(dynamic::object()));
  views->mute(7, true);
  capture->stopRecording();
  CHECK_FALSE(record(dynamic::object()));
  views->mute(7, false);
  hardware->microphone = false;
  CHECK_FALSE(record(dynamic::object()));
  CHECK(hardware->asked == 0);
}

TEST_CASE("NgNativeCamera keeps the mute of the view it found, when the view detaches while it starts the recording") {
  // The view detaches on the main thread while record() runs on the JS thread: a mute read after
  // the lookup would find it forgotten, and record a muted view with sound.
  Folder folder;
  auto hardware = std::make_shared<FakeHardware>();
  hardware->state = Access::Granted;
  auto views = std::make_shared<ngn::CameraViews>();
  auto module = ngn::makeCameraModule(hardware, views, folder.path.string(), false);
  auto capture = std::make_shared<FakeCapture>();
  views->attach(7, capture);
  views->mute(7, true);
  capture->whileChecked = [&] { views->detach(7); };
  module->callWithPromise("record", dynamic::array(7, dynamic::object()), {.resolve = [](dynamic) {}, .reject = [](const std::string &) {}});
  REQUIRE(capture->asked);
  CHECK_FALSE(capture->asked->sound);
  capture->whileChecked = nullptr;
  capture->stopRecording();
}

TEST_CASE("The camera views forget a view's mute as it detaches") {
  ngn::CameraViews views;
  CHECK_FALSE(views.muted(7));
  views.mute(7, true);
  CHECK(views.muted(7));
  CHECK_FALSE(views.muted(8));
  views.attach(7, std::make_shared<FakeCapture>());
  views.detach(7);
  CHECK_FALSE(views.muted(7));
  CHECK_FALSE(views.find(7));
  views.mute(7, true);
  views.mute(7, false);
  CHECK_FALSE(views.muted(7));
}

namespace {

std::shared_ptr<const ngn::CameraProps> cameraProps(const facebook::react::Props::Shared &source, dynamic raw) {
  static auto context = std::make_shared<const facebook::react::ContextContainer>();
  static ngn::CameraComponentDescriptor descriptor({{}, context, nullptr});
  facebook::react::PropsParserContext parserContext{1, *context};
  return std::static_pointer_cast<const ngn::CameraProps>(
      descriptor.cloneProps(parserContext, source, facebook::react::RawProps(std::move(raw))));
}

} // namespace

TEST_CASE("The camera view reads expo-camera's mute, off by default and once removed") {
  CHECK_FALSE(cameraProps(nullptr, dynamic::object())->mute);
  auto muted = cameraProps(nullptr, dynamic::object("mute", true));
  CHECK(muted->mute);
  // A later commit that leaves mute out keeps it; null or false takes it off.
  CHECK(cameraProps(muted, dynamic::object("facing", "front"))->mute);
  CHECK_FALSE(cameraProps(muted, dynamic::object("mute", nullptr))->mute);
  CHECK_FALSE(cameraProps(muted, dynamic::object("mute", false))->mute);
}

TEST_CASE("NgNativeCamera refuses a recording without the camera, from a view not running, and passes a failure on") {
  Folder folder;
  auto hardware = std::make_shared<FakeHardware>();
  auto views = std::make_shared<ngn::CameraViews>();
  auto module = ngn::makeCameraModule(hardware, views, folder.path.string(), false);
  auto capture = std::make_shared<FakeCapture>();
  views->attach(7, capture);
  for (auto access : {Access::NotDetermined, Access::Denied, Access::Restricted}) {
    hardware->state = access;
    CHECK(call(*module, "record", dynamic::array(7, dynamic::object())).error == "Camera.record: camera permission has not been granted");
  }
  CHECK_FALSE(capture->asked);
  hardware->state = Access::Granted;
  CHECK(call(*module, "record", dynamic::array(8, dynamic::object())).error == "Camera is not ready yet. Wait for 'onCameraReady' callback");
  capture->error = "the camera gives no video to record";
  CHECK(call(*module, "record", dynamic::array(7, dynamic::object())).error == "Camera.record: the camera gives no video to record");
}
