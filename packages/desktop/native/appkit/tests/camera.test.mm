// The AppKit half of `<expo-camera>` (camera.mm) on this Mac, with no prompt: the test binary has
// no NSCameraUsageDescription, so asking answers at once, and a session never starts unallowed.
#include "../camera.h"

#import <ImageIO/ImageIO.h>

#include <doctest/doctest.h>

#include <atomic>
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

TEST_CASE("A recording needs a running camera, and one with no video to record fails and leaves the session as it was") {
  NGNRecordingSession *session = [NGNRecordingSession new];
  session.sessionPreset = AVCaptureSessionPresetPhoto;
  auto capture = ngn::appkit::sessionCapture(session, [AVCapturePhotoOutput new]);
  // Sound asked for, which without the microphone allowed adds no microphone (and so asks for
  // nothing); with it allowed, none is asked for, so no real microphone joins the session.
  bool microphoneAllowed = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusAuthorized;
  ngn::CameraRecordingRequest request{.path = "/tmp/ngn-camera-test-never-written.mov", .sound = !microphoneAllowed};

  std::optional<std::string> answered;
  capture->startRecording(request, [&](const std::string &error) { answered = error; });
  REQUIRE(answered);
  CHECK(*answered == "the camera is not running");
  CHECK_FALSE(capture->recording());

  // Running, but with no camera in the session: nothing to record.
  session.fakeRunning = YES;
  std::atomic<bool> done{false};
  std::string error;
  capture->startRecording(request, [&](const std::string &e) {
    error = e;
    done = true;
  });
  CHECK(capture->recording());
  REQUIRE(spinUntil([&] { return done.load(); }));
  CHECK(error == "the camera gives no video to record");
  REQUIRE(spinUntil([&] { return !capture->recording(); }));
  CHECK(session.outputs.count == 0);
  CHECK(session.inputs.count == 0);
  CHECK([session.sessionPreset isEqualToString:AVCaptureSessionPresetPhoto]);
  CHECK_FALSE([NSFileManager.defaultManager fileExistsAtPath:@"/tmp/ngn-camera-test-never-written.mov"]);
  // Stopping with no recording does nothing.
  capture->stopRecording();
  session.fakeRunning = NO;
}

TEST_CASE("A recording keeps its own copy of the request, which the caller may let go of at once, and answers at its limit") {
  // A screen input stands in for a camera: it gives the session video with no camera permission.
  AVCaptureScreenInput *screen = [[AVCaptureScreenInput alloc] initWithDisplayID:CGMainDisplayID()];
  AVCaptureSession *session = [AVCaptureSession new];
  if (screen == nil || ![session canAddInput:screen]) {
    MESSAGE("no screen input here; skipped");
    return;
  }
  [session addInput:screen];
  auto capture = ngn::appkit::sessionCapture(session, [AVCapturePhotoOutput new]);
  bool running = false;
  capture->start([&] { running = true; });
  REQUIRE(spinUntil([&] { return running; }));
  if (!session.running) {
    MESSAGE("the screen input does not run here; skipped");
    capture->stop();
    return;
  }
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"ngn-camera-test-copy.mov"];
  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  // Shared, so a late answer has somewhere to go.
  auto answer = std::make_shared<std::optional<std::string>>();
  {
    // Gone, and its memory written over, before the session's queue reads it.
    auto request = std::make_unique<ngn::CameraRecordingRequest>(
        ngn::CameraRecordingRequest{.path = path.UTF8String, .maxDuration = 0.5, .sound = false});
    capture->startRecording(*request, [answer](const std::string &e) { *answer = e; });
    request->path.assign(4096, 'x');
    request.reset();
  }
  // With a dangling request the queue threw on the path, which ends the process. And the answer
  // comes at the limit: the movie output keeps no delegate of its own.
  for (int i = 0; i < 3 && !answer->has_value(); i++) {
    spinUntil([&] { return answer->has_value(); });
  }
  REQUIRE(answer->has_value());
  CHECK(answer->value() == "");
  CHECK([NSFileManager.defaultManager fileExistsAtPath:path]);
  capture->stop();
  spinUntil([&] { return !capture->recording(); });
  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
}

TEST_CASE("A picture is written as the PNG or the JPEG its request asks for, a JPEG at its quality") {
  // A noisy picture, which a JPEG's quality changes the size of.
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(nullptr, 64, 48, 8, 0, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  auto *pixels = static_cast<uint8_t *>(CGBitmapContextGetData(context));
  for (size_t i = 0; i < CGBitmapContextGetBytesPerRow(context) * 48; i++) {
    pixels[i] = static_cast<uint8_t>((i * 7919) % 251);
  }
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  NSString *folder = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID UUID].UUIDString];
  [NSFileManager.defaultManager createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
  auto written = [&](const std::string &name, const std::string &format, double quality) {
    ngn::CameraPictureRequest request{.path = std::string(folder.UTF8String) + "/" + name, .quality = quality, .format = format};
    REQUIRE(ngn::appkit::writePicture(image, request));
    NSURL *url = [NSURL fileURLWithPath:@(request.path.c_str())];
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, nullptr);
    REQUIRE(source != nullptr);
    NSString *type = (__bridge NSString *)CGImageSourceGetType(source);
    NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr));
    CFRelease(source);
    CHECK([properties[(__bridge NSString *)kCGImagePropertyPixelWidth] intValue] == 64);
    CHECK([properties[(__bridge NSString *)kCGImagePropertyPixelHeight] intValue] == 48);
    NSNumber *size = [NSFileManager.defaultManager attributesOfItemAtPath:@(request.path.c_str()) error:nil][NSFileSize];
    return std::make_pair(std::string(type.UTF8String), size.longLongValue);
  };
  auto png = written("a.png", "png", 0.1);
  CHECK(png.first == "public.png");
  // Lossless: the quality changes nothing.
  CHECK(written("b.png", "png", 1).second == png.second);
  auto low = written("a.jpg", "jpg", 0.1);
  auto high = written("b.jpg", "jpg", 1);
  CHECK(low.first == "public.jpeg");
  CHECK(high.first == "public.jpeg");
  CHECK(low.second < high.second);
  // A folder that is not there: nothing is written, and it says so.
  CHECK_FALSE(ngn::appkit::writePicture(image, {.path = "/nonexistent-ngn-folder/a.png", .format = "png"}));
  CGImageRelease(image);
  [NSFileManager.defaultManager removeItemAtPath:folder error:nil];
}

TEST_CASE("The microphone counts for a recording's sound only when allowed, which is never asked") {
  auto hardware = ngn::appkit::makeCameraHardware();
  bool allowed = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusAuthorized;
  if (!allowed) {
    CHECK_FALSE(hardware->microphoneAllowed());
  } else {
    MESSAGE("the microphone is allowed here; only the absent path is checked");
    CHECK(hardware->microphoneAllowed() == ([AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio] != nil));
  }
}
