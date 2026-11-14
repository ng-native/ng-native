// The AppKit half of `<expo-camera>` (camera.mm) on this Mac, with no prompt: the test binary has
// no NSCameraUsageDescription, so asking answers at once, and a session never starts unallowed.
#include "../camera.h"

#include <doctest/doctest.h>

#include <optional>

using Access = ngn::CameraHardware::Access;

TEST_CASE("The camera hardware answers a request with no usage string at once, without prompting") {
  auto hardware = ngn::appkit::makeCameraHardware();
  auto before = hardware->access();
  std::optional<Access> answered;
  hardware->requestAccess([&](Access access) { answered = access; });
  REQUIRE(answered);
  CHECK(*answered == before);
  CHECK(hardware->access() == before);
  bool present = hardware->hasCamera();
  CHECK(present == (ngn::appkit::cameraFor("front") != nil));
  CHECK(present == (ngn::appkit::cameraFor("back") != nil));
  auto mount = ngn::cameraMount(before, present, true);
  std::string state = std::string("this Mac: camera ") + (present ? "present" : "absent") + ", mount: " + ngn::cameraMountError(mount);
  MESSAGE(state);
}

TEST_CASE("startCapture refuses without the camera allowed, or with no camera, and starts nothing") {
  std::string error;
  auto hardware = ngn::appkit::makeCameraHardware();
  if (hardware->access() == Access::Granted) {
    MESSAGE("the camera is allowed here; only the absent path is checked");
  } else {
    CHECK(ngn::appkit::startCapture(ngn::appkit::cameraFor("back"), error) == nullptr);
    CHECK(error == ngn::cameraMountError(ngn::CameraMount::NotPermitted));
  }
  if (hardware->access() == Access::Granted) {
    error.clear();
    CHECK(ngn::appkit::startCapture(nil, error) == nullptr);
    CHECK(error == ngn::cameraMountError(ngn::CameraMount::NoCamera));
  }
}
