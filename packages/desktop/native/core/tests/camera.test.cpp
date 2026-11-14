#include "ngn/bytes.h"
#include "ngn/camera.h"

#include <doctest/doctest.h>

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
};

struct FakeCapture final : ngn::CameraCapture {
  std::string error;
  void takePicture(double quality, const std::string &path, std::function<void(int, int, const std::string &)> done) override {
    if (!error.empty()) {
      done(0, 0, error);
      return;
    }
    std::ofstream(path, std::ios::binary) << "JPEG@" << quality;
    done(1280, 720, "");
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
  CHECK(ngn::cameraMount(Access::Denied, true, false) == ngn::CameraMount::NotPermitted);
  CHECK(ngn::cameraMount(Access::Restricted, true, false) == ngn::CameraMount::NotPermitted);
  CHECK(ngn::cameraMount(Access::Granted, true, false) == ngn::CameraMount::Start);
  // A Mac with no camera: allowed, and still nothing to start.
  CHECK(ngn::cameraMount(Access::Granted, false, false) == ngn::CameraMount::NoCamera);
  CHECK(ngn::cameraMountError(ngn::CameraMount::NotPermitted) == "Camera permissions not granted - component could not be rendered.");
  CHECK(ngn::cameraMountError(ngn::CameraMount::NoCamera).find("no camera") != std::string::npos);
  CHECK(ngn::cameraMountError(ngn::CameraMount::Start).empty());
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
  CHECK((*picture.value)["base64"] == ngn::base64Encode("JPEG@0.5"));

  CHECK(call(*module, "takePicture", dynamic::array(8, dynamic::object())).error == "Camera is not ready yet. Wait for 'onCameraReady' callback");
  views->detach(7);
  CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object())).error);
  views->attach(7, capture);
  capture->error = "the session stopped";
  CHECK(call(*module, "takePicture", dynamic::array(7, dynamic::object())).error == "Camera.takePicture: the session stopped");
  CHECK(call(*module, "record", dynamic::array(7, dynamic::object())).error == "Camera.record: macOS does not record video yet");
}
