// The camera sheet NgNativeImagePicker's launchCameraAsync shows (camera-sheet.mm), over a capture
// that stands in for the camera: the test binary has no camera permission, and a Mac may have no
// camera at all.
#include "../camera-sheet.h"
#include "../photo-library.h"

#import <ImageIO/ImageIO.h>

#include <doctest/doctest.h>

#include <optional>
#include <vector>

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
  // A recording runs until stopRecording, or until end() (as at its limit), then writes a movie of
  // `clipSeconds` at 32 by 24 to the request's path, or fails with `recordingFailure`.
  std::optional<ngn::CameraRecordingRequest> recorded;
  std::function<void(const std::string &)> recordingDone;
  std::string recordingFailure;
  double clipSeconds{1.5};
  int recordingStops{0};
  void startRecording(const ngn::CameraRecordingRequest &request, std::function<void(const std::string &)> done) override {
    recorded = request;
    recordingDone = std::move(done);
  }
  void stopRecording() override {
    recordingStops++;
    end();
  }
  void end() {
    if (!recordingDone) {
      return;
    }
    auto done = std::move(recordingDone);
    recordingDone = nullptr;
    if (recordingFailure.empty()) {
      writeMovie(recorded->path, 32, 24, clipSeconds);
    }
    done(recordingFailure);
  }
  bool recording() const override {
    return recordingDone != nullptr;
  }
  // The setups asked for ahead of a recording, and how many were taken down.
  std::vector<ngn::CameraRecordingRequest> prepared;
  int unprepared{0};
  void prepareRecording(const ngn::CameraRecordingRequest &request) override {
    prepared.push_back(request);
  }
  void unprepareRecording() override {
    unprepared++;
  }
  ~FakeCapture() override;
  static void writeMovie(const std::string &path, int width, int height, double seconds);
};

// A QuickTime movie of one grey frame held for `seconds`.
void FakeCapture::writeMovie(const std::string &path, int width, int height, double seconds) {
  NSURL *url = [NSURL fileURLWithPath:@(path.c_str())];
  [NSFileManager.defaultManager removeItemAtURL:url error:nil];
  AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:url fileType:AVFileTypeQuickTimeMovie error:nil];
  AVAssetWriterInput *input = [AVAssetWriterInput
      assetWriterInputWithMediaType:AVMediaTypeVideo
                     outputSettings:@{AVVideoCodecKey : AVVideoCodecTypeH264, AVVideoWidthKey : @(width), AVVideoHeightKey : @(height)}];
  AVAssetWriterInputPixelBufferAdaptor *adaptor = [AVAssetWriterInputPixelBufferAdaptor
      assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input
                                 sourcePixelBufferAttributes:@{(NSString *)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)}];
  [writer addInput:input];
  [writer startWriting];
  [writer startSessionAtSourceTime:kCMTimeZero];
  CVPixelBufferRef frame = nullptr;
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, nullptr, &frame);
  CVPixelBufferLockBaseAddress(frame, 0);
  memset(CVPixelBufferGetBaseAddress(frame), 0x80, CVPixelBufferGetBytesPerRow(frame) * height);
  CVPixelBufferUnlockBaseAddress(frame, 0);
  while (!input.readyForMoreMediaData) {
    [NSThread sleepForTimeInterval:0.01];
  }
  [adaptor appendPixelBuffer:frame withPresentationTime:kCMTimeZero];
  CVPixelBufferRelease(frame);
  [input markAsFinished];
  [writer endSessionAtSourceTime:CMTimeMakeWithSeconds(seconds, 600)];
  dispatch_semaphore_t finished = dispatch_semaphore_create(0);
  [writer finishWritingWithCompletionHandler:^{
    dispatch_semaphore_signal(finished);
  }];
  dispatch_semaphore_wait(finished, DISPATCH_TIME_FOREVER);
}

FakeCapture::~FakeCapture() {
  CGImageRelease(image);
}

struct Answer {
  int calls{0};
  std::optional<ngn::CameraShot> shot;
  std::optional<ngn::CameraClip> clip;
  NSDictionary *exif{nil};
  std::string error;
};

NGNCameraSheet *sheetFor(std::shared_ptr<FakeCapture> capture, ngn::CameraSheetRequest request, std::shared_ptr<Answer> answer) {
  return [[NGNCameraSheet alloc] initWithCapture:capture
                                         request:request
                                            done:[answer](ngn::CameraTake take, NSDictionary *exif, const std::string &error) {
                                              answer->calls++;
                                              answer->shot = take.photo;
                                              answer->clip = take.video;
                                              answer->exif = exif;
                                              answer->error = error;
                                            }];
}

// A sheet that takes photos only.
NGNCameraSheet *sheetFor(std::shared_ptr<FakeCapture> capture, const std::string &path, std::shared_ptr<Answer> answer) {
  return sheetFor(capture, {.photo = {.path = path, .quality = 0.8, .format = "jpg"}}, answer);
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
  // Filled, the picture overflows: clipped, it stays off the buttons' bar.
  CHECK(sheet.preview.masksToBounds);
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

TEST_CASE("A cancel after the photo is written but before it is answered stays a cancel, and leaves no file") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryPath(@"jpg");
  NGNCameraSheet *sheet = sheetFor(capture, path, answer);
  (void)sheet.view;
  [sheet cameraRunning];
  // The fake camera writes the photo at once; its answer waits on the main queue, not drained yet.
  [sheet takePhoto:nil];
  CHECK([NSFileManager.defaultManager fileExistsAtPath:@(path.c_str())]);
  [sheet cancel:nil];
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);
  CHECK(answer->calls == 1);
  CHECK_FALSE(answer->shot);
  CHECK(answer->error.empty());
  CHECK_FALSE([NSFileManager.defaultManager fileExistsAtPath:@(path.c_str())]);
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
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
  camera->shoot({.videos = true, .photo = {.path = temporaryPath(@"jpg")}}, [&](ngn::CameraTake answer, const std::string &e) {
    shot = answer.photo || answer.video;
    error = e;
  });
  REQUIRE(spinUntil([&] { return error.has_value(); }));
  CHECK_FALSE(shot);
  CHECK(error->empty());
}

namespace {

std::string temporaryMovie() {
  return temporaryPath(@"mov");
}

ngn::CameraSheetRequest videoRequest(const std::string &path, bool photos = false) {
  return {.photos = photos, .videos = true, .photo = {.path = temporaryPath(@"jpg")}, .video = {.path = path, .maxDuration = 30, .preset = "640x480"}};
}

NSEvent *keyDown(NSString *characters) {
  return [NSEvent keyEventWithType:NSEventTypeKeyDown
                          location:NSZeroPoint
                     modifierFlags:0
                         timestamp:0
                      windowNumber:0
                           context:nil
                        characters:characters
       charactersIgnoringModifiers:characters
                         isARepeat:NO
                           keyCode:0];
}

} // namespace

TEST_CASE("A sheet for videos alone records: Record, then Stop, with the time recorded and no mode switch") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(path), answer);
  (void)sheet.view;
  CHECK(sheet.videoMode);
  CHECK(bool(sheet.modeSwitch == nil));
  // Set up to record from the start, so Record begins at once.
  REQUIRE(capture->prepared.size() == 1);
  CHECK(capture->prepared[0].path == path);
  CHECK(capture->prepared[0].preset == "640x480");
  CHECK([sheet.shutter.title isEqualToString:@"Record"]);
  CHECK([sheet.shutter.keyEquivalent isEqualToString:@"\r"]);
  CHECK([sheet.cancelButton.keyEquivalent isEqualToString:@"\x1b"]);
  CHECK_FALSE(sheet.elapsed.hidden);
  CHECK([sheet.elapsed.stringValue isEqualToString:@"00:00:00"]);
  // Nothing to record until the camera runs, and no photo in video mode.
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet record:nil];
  CHECK_FALSE(capture->recorded);
  [sheet cameraRunning];
  CHECK(sheet.shutter.enabled);
  [sheet takePhoto:nil];
  CHECK(capture->shots == 0);

  [sheet record:nil];
  REQUIRE(capture->recorded);
  // The movie the request asks for: its path, its limit and its quality.
  CHECK(capture->recorded->path == path);
  CHECK(capture->recorded->maxDuration == 30);
  CHECK(capture->recorded->preset == "640x480");
  CHECK([sheet.shutter.title isEqualToString:@"Stop"]);
  CHECK(sheet.shutter.enabled);
  CHECK(spinUntil([&] { return [sheet.elapsed.stringValue isEqualToString:@"00:00:01"]; }));
  // The shutter's buttons stay where they were as the title changes.
  CHECK(NSMinX(sheet.shutter.frame) > NSMaxX(sheet.cancelButton.frame));

  [sheet record:nil];
  CHECK(capture->recordingStops == 1);
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK(answer->calls == 1);
  REQUIRE(answer->clip);
  CHECK_FALSE(answer->shot);
  CHECK(answer->error.empty());
  CHECK(answer->clip->width == 32);
  CHECK(answer->clip->height == 24);
  CHECK(answer->clip->duration == doctest::Approx(1500).epsilon(0.01));
  CHECK(capture->stops == 1);
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet record:nil];
  CHECK(capture->recordingStops == 1);
  // The time recorded stops with the recording.
  NSString *stopped = sheet.elapsed.stringValue;
  CHECK_FALSE(spinUntil([&] { return ![sheet.elapsed.stringValue isEqualToString:stopped]; }));
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
}

TEST_CASE("A recording that ends on its own, at its limit, answers the movie with no Stop") {
  auto capture = std::make_shared<FakeCapture>();
  capture->clipSeconds = 0.5;
  auto answer = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(path), answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet record:nil];
  capture->end();
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  REQUIRE(answer->clip);
  CHECK(answer->clip->duration == doctest::Approx(500).epsilon(0.01));
  CHECK(capture->recordingStops == 0);
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
}

TEST_CASE("Stop turns the shutter off until the movie is finished") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(path), answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet record:nil];
  // A capture that answers later: the done is held past stopRecording.
  auto held = std::move(capture->recordingDone);
  capture->recordingDone = nullptr;
  [sheet record:nil];
  CHECK_FALSE(sheet.shutter.enabled);
  [sheet record:nil];
  [sheet cameraRunning];
  CHECK_FALSE(sheet.shutter.enabled);
  CHECK(answer->calls == 0);
  FakeCapture::writeMovie(path, 32, 24, 1);
  held("");
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK(answer->clip);
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
}

TEST_CASE("Cancel while recording answers nothing, stops the camera, and leaves no movie behind") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(path), answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet record:nil];
  [sheet cancel:nil];
  CHECK(answer->calls == 1);
  CHECK_FALSE(answer->clip);
  CHECK(answer->error.empty());
  CHECK(capture->stops == 1);
  // Stopping the camera ends its recording, which finishes the file after the answer.
  capture->end();
  CHECK(spinUntil([&] { return ![NSFileManager.defaultManager fileExistsAtPath:@(path.c_str())]; }));
  CHECK(answer->calls == 1);
}

TEST_CASE("A recording that fails answers its error and no movie") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto failedPath = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(failedPath), answer);
  (void)sheet.view;
  [sheet cameraRunning];
  [sheet record:nil];
  // The recording fails part way, with some of the movie written: none of it is kept.
  auto failed = std::move(capture->recordingDone);
  capture->recordingDone = nullptr;
  FakeCapture::writeMovie(failedPath, 32, 24, 0.5);
  failed("the disk is full");
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK_FALSE(answer->clip);
  CHECK(answer->error == "the disk is full");
  CHECK_FALSE([NSFileManager.defaultManager fileExistsAtPath:@(failedPath.c_str())]);

  // A file with no video in it is no movie either.
  auto unreadable = std::make_shared<FakeCapture>();
  auto other = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *broken = sheetFor(unreadable, videoRequest(path), other);
  (void)broken.view;
  [broken cameraRunning];
  [broken record:nil];
  auto done = std::move(unreadable->recordingDone);
  unreadable->recordingDone = nullptr;
  [@"not a movie" writeToFile:@(path.c_str()) atomically:YES encoding:NSUTF8StringEncoding error:nil];
  done("");
  REQUIRE(spinUntil([&] { return other->calls > 0; }));
  CHECK_FALSE(other->clip);
  CHECK(other->error == "the video could not be read");
  CHECK_FALSE([NSFileManager.defaultManager fileExistsAtPath:@(path.c_str())]);
}

TEST_CASE("A sheet for photos and videos opens in photo mode, with a switch that is fixed while recording") {
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(path, true), answer);
  NSView *view = sheet.view;
  REQUIRE(bool(sheet.modeSwitch != nil));
  CHECK(sheet.modeSwitch.segmentCount == 2);
  CHECK([[sheet.modeSwitch labelForSegment:0] isEqualToString:@"Photo"]);
  CHECK([[sheet.modeSwitch labelForSegment:1] isEqualToString:@"Video"]);
  CHECK(sheet.modeSwitch.selectedSegment == 0);
  CHECK_FALSE(sheet.videoMode);
  CHECK([sheet.shutter.title isEqualToString:@"Take Photo"]);
  CHECK(sheet.elapsed.hidden);
  // On the bar, left of the buttons, clear of the time recorded.
  CHECK(NSMaxX(sheet.modeSwitch.frame) < NSMinX(sheet.elapsed.frame));
  CHECK(NSMaxX(sheet.elapsed.frame) < NSMinX(sheet.cancelButton.frame));
  CHECK(NSMaxY(sheet.modeSwitch.frame) < 52);
  (void)view;
  [sheet cameraRunning];
  // Photo mode: the camera is set up for photos, as it started.
  CHECK(capture->prepared.empty());

  sheet.modeSwitch.selectedSegment = 1;
  [sheet switchMode:sheet.modeSwitch];
  CHECK(sheet.videoMode);
  CHECK([sheet.shutter.title isEqualToString:@"Record"]);
  CHECK(capture->prepared.size() == 1);
  // Choosing the mode it is in already sets nothing up again.
  [sheet switchMode:sheet.modeSwitch];
  CHECK(capture->prepared.size() == 1);
  CHECK_FALSE(sheet.elapsed.hidden);
  [sheet takePhoto:nil];
  CHECK(capture->shots == 0);
  [sheet record:nil];
  REQUIRE(capture->recorded);
  CHECK_FALSE(sheet.modeSwitch.enabled);
  sheet.modeSwitch.selectedSegment = 0;
  [sheet switchMode:sheet.modeSwitch];
  CHECK(sheet.videoMode);
  CHECK(sheet.modeSwitch.selectedSegment == 1);
  CHECK(capture->unprepared == 0);
  [sheet record:nil];
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK(answer->clip);
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];

  // Back to photo mode, the shutter takes a photo.
  auto photoCapture = std::make_shared<FakeCapture>();
  auto photo = std::make_shared<Answer>();
  NGNCameraSheet *either = sheetFor(photoCapture, videoRequest(temporaryMovie(), true), photo);
  (void)either.view;
  [either cameraRunning];
  either.modeSwitch.selectedSegment = 1;
  [either switchMode:nil];
  either.modeSwitch.selectedSegment = 0;
  [either switchMode:nil];
  CHECK_FALSE(either.videoMode);
  // Back for photos: the video setup is taken down.
  CHECK(photoCapture->prepared.size() == 1);
  CHECK(photoCapture->unprepared == 1);
  CHECK([either.shutter.title isEqualToString:@"Take Photo"]);
  [either record:nil];
  CHECK_FALSE(photoCapture->recorded);
  [either takePhoto:nil];
  REQUIRE(spinUntil([&] { return photo->calls > 0; }));
  CHECK(photo->shot);
  CHECK_FALSE(photo->clip);
}

TEST_CASE("Return records and stops, and Escape cancels, in the sheet's window") {
  // The sheet's own window, not attached: a window on screen takes key equivalents only once it is
  // key, which a test process's never is. Attaching and ending it is checked above.
  NSWindow *parent = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1040, 720)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  auto capture = std::make_shared<FakeCapture>();
  auto answer = std::make_shared<Answer>();
  auto path = temporaryMovie();
  NGNCameraSheet *sheet = sheetFor(capture, videoRequest(path), answer);
  NSWindow *window = ngn::appkit::pickerSheet(sheet, parent);
  // Not before the camera runs.
  [window.contentView performKeyEquivalent:keyDown(@"\r")];
  CHECK_FALSE(capture->recorded);
  [sheet cameraRunning];
  CHECK([window.contentView performKeyEquivalent:keyDown(@"\r")]);
  REQUIRE(capture->recorded);
  CHECK(capture->recording());
  CHECK([window.contentView performKeyEquivalent:keyDown(@"\r")]);
  CHECK(capture->recordingStops == 1);
  REQUIRE(spinUntil([&] { return answer->calls > 0; }));
  CHECK(answer->clip);
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];

  // Escape while recording.
  auto other = std::make_shared<FakeCapture>();
  auto cancelled = std::make_shared<Answer>();
  NGNCameraSheet *second = sheetFor(other, videoRequest(temporaryMovie()), cancelled);
  NSWindow *again = ngn::appkit::pickerSheet(second, parent);
  [second cameraRunning];
  CHECK([again.contentView performKeyEquivalent:keyDown(@"\r")]);
  CHECK(other->recording());
  CHECK([again.contentView performKeyEquivalent:keyDown(@"\x1b")]);
  CHECK(cancelled->calls == 1);
  CHECK_FALSE(cancelled->clip);
  CHECK(other->stops == 1);
  other->end();
  [parent close];
}

TEST_CASE("A movie's size and length are read from its file, and a file with no video has none") {
  auto path = temporaryMovie();
  FakeCapture::writeMovie(path, 48, 32, 2.25);
  auto clip = ngn::appkit::movieClip(path);
  REQUIRE(clip);
  CHECK(clip->width == 48);
  CHECK(clip->height == 32);
  CHECK(clip->duration == doctest::Approx(2250).epsilon(0.01));
  [@"not a movie" writeToFile:@(path.c_str()) atomically:YES encoding:NSUTF8StringEncoding error:nil];
  CHECK_FALSE(ngn::appkit::movieClip(path));
  CHECK_FALSE(ngn::appkit::movieClip("/nonexistent-ngn-folder/a.mov"));
  [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
}

TEST_CASE("With no key or main window, as just after a permission prompt, the sheet goes on the app's front window") {
  REQUIRE(bool(NSApp.keyWindow == nil));
  REQUIRE(bool(NSApp.mainWindow == nil));
  CHECK(bool(ngn::appkit::windowForSheet() == nil));
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  [window orderFront:nil];
  if (NSApp.keyWindow != nil || NSApp.mainWindow != nil) {
    MESSAGE("the window became key here; only the empty case is checked");
    [window orderOut:nil];
    return;
  }
  CHECK(bool(ngn::appkit::windowForSheet() == window));
  // One already holding a sheet cannot take another.
  NSWindow *other = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 100)
                                                styleMask:NSWindowStyleMaskTitled
                                                  backing:NSBackingStoreBuffered
                                                    defer:NO];
  [window beginSheet:other completionHandler:nil];
  REQUIRE(spinUntil([&] { return window.attachedSheet != nil; }));
  CHECK(bool(ngn::appkit::windowForSheet() == nil));
  [window endSheet:other];
  [window orderOut:nil];
  CHECK(bool(ngn::appkit::windowForSheet() == nil));
}
