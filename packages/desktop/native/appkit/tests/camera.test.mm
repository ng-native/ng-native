// The AppKit half of `<expo-camera>` (camera.mm) on this Mac, with no prompt: the test binary has
// no NSCameraUsageDescription, so asking answers at once, and a session never starts unallowed.
#include "../camera.h"

#include <doctest/doctest.h>

#include <optional>

// A session that records where it is started and stopped, and stands for a camera that takes a
// while to come up: AVCaptureSession's startRunning and stopRunning block until it is up or down.
@interface NGNRecordingSession : AVCaptureSession
@property(atomic) int starts;
@property(atomic) int stops;
@property(atomic) BOOL startedOnMain;
@property(atomic) BOOL stoppedOnMain;
@property(atomic) BOOL fakeRunning;
@end

@implementation NGNRecordingSession
- (void)startRunning {
  self.startedOnMain = NSThread.isMainThread;
  [NSThread sleepForTimeInterval:0.05];
  self.fakeRunning = YES;
  self.starts++;
}
- (void)stopRunning {
  self.stoppedOnMain = NSThread.isMainThread;
  self.fakeRunning = NO;
  self.stops++;
}
- (BOOL)isRunning {
  return self.fakeRunning;
}
@end

namespace {

template <typename Done>
bool spinUntil(Done done) {
  for (int i = 0; i < 100 && !done(); i++) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  return done();
}

} // namespace

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
    CHECK(ngn::appkit::startCapture(ngn::appkit::cameraFor("back"), error, nullptr) == nullptr);
    CHECK(error == ngn::cameraMountError(ngn::CameraMount::NotPermitted));
  }
  if (hardware->access() == Access::Granted) {
    error.clear();
    CHECK(ngn::appkit::startCapture(nil, error, nullptr) == nullptr);
    CHECK(error == ngn::cameraMountError(ngn::CameraMount::NoCamera));
  }
}

TEST_CASE("A capture session starts and stops off the main thread, and says it is running on the main thread") {
  NGNRecordingSession *session = [NGNRecordingSession new];
  auto capture = ngn::appkit::sessionCapture(session, [AVCapturePhotoOutput new]);
  bool ready = false;
  bool readyOnMain = false;
  capture->start([&] {
    ready = true;
    readyOnMain = NSThread.isMainThread;
  });
  // The main thread is not held while the camera comes up.
  CHECK(session.starts == 0);
  CHECK_FALSE(ready);
  REQUIRE(spinUntil([&] { return ready; }));
  CHECK(readyOnMain);
  CHECK(session.starts == 1);
  CHECK_FALSE(session.startedOnMain);

  capture->stop();
  REQUIRE(spinUntil([&] { return session.stops == 1; }));
  CHECK_FALSE(session.stoppedOnMain);
  // Stopped already, it is not stopped again as it goes.
  capture = nullptr;
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
  CHECK(session.stops == 1);
}
