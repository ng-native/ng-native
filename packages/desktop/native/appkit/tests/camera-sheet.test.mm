// The camera sheet NgNativeImagePicker's launchCameraAsync shows (camera-sheet.mm), over a capture
// that stands in for the camera: the test binary has no camera permission, and a Mac may have no
// camera at all.
#include "../camera-sheet.h"
#include "../photo-library.h"

#import <ImageIO/ImageIO.h>

#include <doctest/doctest.h>

#include <optional>

namespace {

// A camera that is running at once and takes a 64 by 48 still, or fails.
struct FakeCapture final : ngn::appkit::SessionCapture {
  AVCaptureSession *session_ = [AVCaptureSession new];
  CGImageRef image{nullptr};
  std::string failure;
  int shots{0};
  int stops{0};
  FakeCapture() {
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(nullptr, 64, 48, 8, 0, space, kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    CGContextSetRGBFillColor(context, 1, 0, 0, 1);
    CGContextFillRect(context, CGRectMake(0, 0, 64, 48));
    image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
  }
  ~FakeCapture() override {
    CGImageRelease(image);
  }
  AVCaptureSession *session() const override {
    return session_;
  }
  void start(std::function<void()> running) override {
    running();
  }
  void stop() override {
    stops++;
  }
  // Set, a still is held until develop(), as a real camera takes a moment.
  bool slow{false};
  ngn::appkit::PhotoDone held;
  void capturePhoto(ngn::appkit::PhotoDone done) override {
    shots++;
    if (slow) {
      held = std::move(done);
      return;
    }
    develop(std::move(done));
  }
  void develop(ngn::appkit::PhotoDone done) {
    NSDictionary *metadata = @{(__bridge NSString *)kCGImagePropertyExifDictionary : @{@"ExposureTime" : @0.01}};
    done(failure.empty() ? image : nullptr, metadata, failure);
  }
  void startRecording(const ngn::CameraRecordingRequest &, std::function<void(const std::string &)> done) override {
    done("not here");
  }
  void stopRecording() override {}
  bool recording() const override {
    return false;
  }
};

struct Answer {
  int calls{0};
  std::optional<ngn::CameraShot> shot;
  NSDictionary *exif{nil};
  std::string error;
};

NGNCameraSheet *sheetFor(std::shared_ptr<FakeCapture> capture, const std::string &path, std::shared_ptr<Answer> answer) {
  ngn::CameraPictureRequest request{.path = path, .quality = 0.8, .format = "jpg"};
  return [[NGNCameraSheet alloc] initWithCapture:capture
                                         request:request
                                            done:[answer](std::optional<ngn::CameraShot> shot, NSDictionary *exif, const std::string &error) {
                                              answer->calls++;
                                              answer->shot = shot;
                                              answer->exif = exif;
                                              answer->error = error;
                                            }];
}

template <typename Done>
bool spinUntil(Done done) {
  for (int i = 0; i < 100 && !done(); i++) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  return done();
}

std::string temporaryPath(NSString *extension) {
  return [[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] stringByAppendingPathExtension:extension].UTF8String;
}

} // namespace

TEST_CASE("The camera sheet fills with the preview, with Cancel on Escape and Take Photo on Return once the camera runs") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  NGNCameraSheet *sheet = sheetFor(capture, temporaryPath(@"jpg"), answer);
  NSView *view = sheet.view;
  CHECK([sheet.preview.videoGravity isEqualToString:AVLayerVideoGravityResizeAspectFill]);
  CHECK(bool(sheet.preview.session == capture->session()));
  NSView *preview = nil;
  for (NSView *child in view.subviews) {
    if (child.layer == sheet.preview) {
      preview = child;
    }
  }
  REQUIRE(bool(preview != nil));
  CHECK([[preview accessibilityLabel] isEqualToString:@"Camera preview"]);
  // The preview fills the sheet above the buttons' bar, and keeps doing so as it resizes.
  CHECK(NSMaxY(preview.frame) == NSMaxY(view.bounds));
  CHECK(preview.frame.size.width == view.bounds.size.width);
  [view setFrameSize:NSMakeSize(460, 340)];
  CHECK(preview.frame.size.width == 460);
  CHECK(NSMaxY(preview.frame) == 340);
  CHECK(NSMaxX(sheet.shutter.frame) <= 460);
  CHECK(NSMinY(sheet.shutter.frame) < NSMinY(preview.frame));

  CHECK([sheet.shutter.keyEquivalent isEqualToString:@"\r"]);
  CHECK([sheet.cancelButton.keyEquivalent isEqualToString:@"\x1b"]);
  CHECK([sheet.shutter.title isEqualToString:@"Take Photo"]);
  CHECK([sheet.cancelButton.title isEqualToString:@"Cancel"]);
  // The action is rightmost, as a dialog's is.
  CHECK(NSMinX(sheet.shutter.frame) > NSMaxX(sheet.cancelButton.frame));
  // Nothing to take until the camera runs.
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet takePhoto:nil];
  CHECK(capture->shots == 0);
  [sheet cameraRunning];
  CHECK(sheet.shutter.enabled);
}

TEST_CASE("Take Photo writes the photo the request asks for and answers it once, with the camera's EXIF, then stops the camera") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryPath(@"jpg");
  NGNCameraSheet *sheet = sheetFor(capture, path, answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet takePhoto:nil];
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK(answer->calls == 1);
  REQUIRE(answer->shot);
  CHECK(answer->shot->width == 64);
  CHECK(answer->shot->height == 48);
  CHECK(answer->error.empty());
  CHECK([answer->exif[@"ExposureTime"] doubleValue] == doctest::Approx(0.01));
  CHECK(capture->stops == 1);
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:@(path.c_str())], nullptr);
  REQUIRE(source != nullptr);
  CHECK([(__bridge NSString *)CGImageSourceGetType(source) isEqualToString:@"public.jpeg"]);
  CFRelease(source);
  // Done: neither button does anything more.
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet takePhoto:nil];
  [sheet cancel:nil];
  [sheet cameraRunning];
  CHECK_FALSE(sheet.shutter.enabled);
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
  CHECK(capture->shots == 1);
  CHECK(answer->calls == 1);
  CHECK(capture->stops == 1);
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
}

TEST_CASE("Cancel, or the sheet going another way, answers no photo and no error, and stops the camera") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  NGNCameraSheet *sheet = sheetFor(capture, temporaryPath(@"jpg"), answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet cancel:nil];
  CHECK(answer->calls == 1);
  CHECK_FALSE(answer->shot);
  CHECK(answer->error.empty());
  CHECK(capture->stops == 1);
  [sheet takePhoto:nil];
  CHECK(capture->shots == 0);

  auto gone = std::make_shared<Answer>();
  auto other = std::make_shared<FakeCapture>();
  NGNCameraSheet *closed = sheetFor(other, temporaryPath(@"jpg"), gone);
  (void)closed.view;
  [closed viewDidDisappear];
  CHECK(gone->calls == 1);
  CHECK_FALSE(gone->shot);
  CHECK(other->stops == 1);
}

TEST_CASE("A camera that fails answers its error and no photo") {
  auto capture = std::make_shared<FakeCapture>();
  capture->failure = "the camera stopped";
  auto answer = std::make_shared<Answer>();
  auto path = temporaryPath(@"jpg");
  NGNCameraSheet *sheet = sheetFor(capture, path, answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet takePhoto:nil];
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK_FALSE(answer->shot);
  CHECK(answer->error == "the camera stopped");
  CHECK_FALSE([NSFileManager.defaultManager fileExistsAtPath:@(path.c_str())]);
}

TEST_CASE("The shutter stays off while a photo is being taken, even if the camera says it runs again") {
  auto capture = std::make_shared<FakeCapture>();
  capture->slow = true;
  auto answer = std::make_shared<Answer>();
  NGNCameraSheet *sheet = sheetFor(capture, temporaryPath(@"jpg"), answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet takePhoto:nil];
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet cameraRunning];
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet takePhoto:nil];
  CHECK(capture->shots == 1);
  REQUIRE(capture->held);
  capture->develop(std::move(capture->held));
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK(answer->shot);
}

TEST_CASE("A photo that cannot be written answers that, and no photo") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  NGNCameraSheet *sheet = sheetFor(capture, "/nonexistent-ngn-folder/a.jpg", answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet takePhoto:nil];
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK_FALSE(answer->shot);
  CHECK(answer->error == "the picture could not be saved");
  CHECK(capture->stops == 1);
}

TEST_CASE("The sheet shows on its window and goes when it is answered") {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1040, 720)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  NGNCameraSheet *sheet = sheetFor(capture, temporaryPath(@"jpg"), answer);
  NSWindow *shown = ngn::appkit::pickerSheet(sheet, window);
  [window beginSheet:shown completionHandler:nil];
  REQUIRE(spinUntil([&] { return window.attachedSheet != nil; }));
  CHECK(shown.contentLayoutRect.size.width == 780);
  [sheet cancel:nil];
  CHECK(spinUntil([&] { return window.attachedSheet == nil; }));
  CHECK(answer->calls == 1);
  [window close];
}

TEST_CASE("The preview is mirrored, as a camera facing the user is shown on a Mac") {
  // A screen input stands in for a camera: it gives the preview a connection with no permission.
  AVCaptureScreenInput *screen = [[AVCaptureScreenInput alloc] initWithDisplayID:CGMainDisplayID()];
  auto capture = std::make_shared<FakeCapture>();
  if (screen == nil || ![capture->session_ canAddInput:screen]) {
    MESSAGE("no screen input here; skipped");
    return;
  }
  [capture->session_ addInput:screen];
  NGNCameraSheet *sheet = sheetFor(capture, temporaryPath(@"jpg"), std::make_shared<Answer>());
  (void)sheet.view;
  AVCaptureConnection *connection = sheet.preview.connection;
  REQUIRE(bool(connection != nil));
  if (!connection.isVideoMirroringSupported) {
    MESSAGE("this connection cannot mirror; skipped");
    return;
  }
  CHECK_FALSE(connection.automaticallyAdjustsVideoMirroring);
  CHECK(connection.videoMirrored);
}

TEST_CASE("With no window to show it on, the camera answers no photo and starts nothing") {
  REQUIRE(bool(NSApp.keyWindow == nil));
  REQUIRE(bool(NSApp.mainWindow == nil));
  auto camera = ngn::appkit::makeCameraSheet();
  std::optional<std::string> error;
  bool shot = true;
  camera->shoot({.path = temporaryPath(@"jpg")}, [&](std::optional<ngn::CameraShot> answer, const std::string &e) {
    shot = answer.has_value();
    error = e;
  });
  REQUIRE(spinUntil([&] { return error.has_value(); }));
  CHECK_FALSE(shot);
  CHECK(error->empty());
}
