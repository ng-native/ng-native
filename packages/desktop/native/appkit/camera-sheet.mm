#import "camera-sheet.h"

#import "photo-library.h"
#import "system-access.h"

#import <ImageIO/ImageIO.h>
#import <QuartzCore/QuartzCore.h>

#include <cmath>

namespace {

// The bar under the preview that holds the buttons, and the room around them.
constexpr CGFloat kBar = 52;
constexpr CGFloat kInset = 20;

// The time recorded as iOS's camera shows it, hours, minutes and seconds.
NSString *elapsedText(double seconds) {
  auto whole = static_cast<long>(std::floor(std::max(0.0, seconds)));
  return [NSString stringWithFormat:@"%02ld:%02ld:%02ld", whole / 3600, whole / 60 % 60, whole % 60];
}

} // namespace

@implementation NGNCameraSheet {
  std::shared_ptr<ngn::appkit::SessionCapture> _capture;
  ngn::CameraSheetRequest _request;
  CameraSheetDone _done;
  BOOL _running;
  // A photo is being taken, a recording runs, or one is being stopped.
  BOOL _taking;
  BOOL _recording;
  BOOL _stopping;
  CFTimeInterval _recordingSince;
  NSTimer *_clock;
}

- (instancetype)initWithCapture:(std::shared_ptr<ngn::appkit::SessionCapture>)capture
                        request:(ngn::CameraSheetRequest)request
                           done:(CameraSheetDone)done {
  if ((self = [super initWithNibName:nil bundle:nil])) {
    _capture = std::move(capture);
    _request = std::move(request);
    _done = std::move(done);
    // Photo mode first, as iOS's camera opens, unless only videos are asked for.
    _videoMode = _request.videos && !_request.photos;
  }
  return self;
}

- (void)loadView {
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 780, 560)];

  _preview = [AVCaptureVideoPreviewLayer layerWithSession:_capture->session()];
  _preview.videoGravity = AVLayerVideoGravityResizeAspectFill;
  _preview.backgroundColor = NSColor.blackColor.CGColor;
  // Mirrored, as a camera facing the user is shown on a Mac; the photo and the movie are not.
  AVCaptureConnection *connection = _preview.connection;
  if (connection.isVideoMirroringSupported) {
    connection.automaticallyAdjustsVideoMirroring = NO;
    connection.videoMirrored = YES;
  }
  NSView *preview = [[NSView alloc] initWithFrame:NSMakeRect(0, kBar, 780, 560 - kBar)];
  preview.layer = _preview;
  preview.wantsLayer = YES;
  // Filled, the picture overflows the preview on one side, and must not cover the buttons' bar.
  // AppKit sets the layer's masksToBounds from this.
  preview.clipsToBounds = YES;
  preview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [preview setAccessibilityElement:YES];
  [preview setAccessibilityRole:NSAccessibilityImageRole];
  [preview setAccessibilityLabel:@"Camera preview"];
  [view addSubview:preview];

  // The shutter is the default button, rightmost, as a dialog's action is; Cancel is beside it.
  // Both are as wide as the widest title either takes, so they stay put as the shutter's changes.
  _shutter = [NSButton buttonWithTitle:@"" target:self action:nil];
  _shutter.keyEquivalent = @"\r";
  _shutter.enabled = NO;
  _cancelButton = [NSButton buttonWithTitle:@"Cancel" target:self action:@selector(cancel:)];
  _cancelButton.keyEquivalent = @"\x1b";
  CGFloat width = 0;
  for (NSString *title in @[ @"Take Photo", @"Record", @"Stop", @"Cancel" ]) {
    _shutter.title = title;
    [_shutter sizeToFit];
    width = std::max(width, _shutter.frame.size.width);
  }
  [_cancelButton sizeToFit];
  CGFloat y = (kBar - _shutter.frame.size.height) / 2;
  _shutter.frame = NSMakeRect(780 - kInset - width, y, width, _shutter.frame.size.height);
  _cancelButton.frame = NSMakeRect(NSMinX(_shutter.frame) - 12 - width, y, width, _cancelButton.frame.size.height);
  for (NSButton *button in @[ _shutter, _cancelButton ]) {
    button.autoresizingMask = NSViewMinXMargin | NSViewMaxYMargin;
    [view addSubview:button];
  }

  _elapsed = [NSTextField labelWithString:elapsedText(0)];
  _elapsed.font = [NSFont monospacedDigitSystemFontOfSize:NSFont.systemFontSize weight:NSFontWeightRegular];
  [_elapsed sizeToFit];
  _elapsed.frame = NSMakeRect((780 - _elapsed.frame.size.width) / 2, (kBar - _elapsed.frame.size.height) / 2, _elapsed.frame.size.width,
                              _elapsed.frame.size.height);
  _elapsed.autoresizingMask = NSViewMinXMargin | NSViewMaxXMargin | NSViewMaxYMargin;
  [_elapsed setAccessibilityLabel:@"Time recorded"];
  [view addSubview:_elapsed];

  if (_request.photos && _request.videos) {
    _modeSwitch = [NSSegmentedControl segmentedControlWithLabels:@[ @"Photo", @"Video" ]
                                                     trackingMode:NSSegmentSwitchTrackingSelectOne
                                                           target:self
                                                           action:@selector(switchMode:)];
    [_modeSwitch sizeToFit];
    _modeSwitch.frame = NSMakeRect(kInset, (kBar - _modeSwitch.frame.size.height) / 2, _modeSwitch.frame.size.width, _modeSwitch.frame.size.height);
    _modeSwitch.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    [_modeSwitch setAccessibilityLabel:@"Camera mode"];
    [view addSubview:_modeSwitch];
  }
  self.view = view;
  [self refresh];
  if (_videoMode) {
    _capture->prepareRecording(_request.video);
  }
}

// Puts the controls in step with the mode and what is under way.
- (void)refresh {
  if (!self.viewLoaded) {
    return;
  }
  BOOL answered = !_done;
  if (_videoMode) {
    _shutter.title = _recording ? @"Stop" : @"Record";
    _shutter.action = @selector(record:);
  } else {
    _shutter.title = @"Take Photo";
    _shutter.action = @selector(takePhoto:);
  }
  _shutter.enabled = _running && !answered && !_taking && !_stopping;
  _elapsed.hidden = !_videoMode;
  _modeSwitch.selectedSegment = _videoMode ? 1 : 0;
  _modeSwitch.enabled = !answered && !_taking && !_recording && !_stopping;
}

- (void)cameraRunning {
  _running = YES;
  [self refresh];
}

- (void)switchMode:(id)sender {
  // Fixed while recording or once answered: the switch goes back to the mode in use.
  BOOL video = _modeSwitch.selectedSegment == 1;
  if (_modeSwitch.enabled && video != _videoMode) {
    _videoMode = video;
    // The camera is set up for video as the mode changes, as iOS's is, so Record starts at once.
    if (_videoMode) {
      _capture->prepareRecording(_request.video);
    } else {
      _capture->unprepareRecording();
    }
  }
  [self refresh];
}

- (void)takePhoto:(id)sender {
  // Disabled until the camera runs, while a photo is taken, and once answered.
  if (_videoMode || !_shutter.enabled) {
    return;
  }
  _taking = YES;
  [self refresh];
  NGNCameraSheet *sheet = self;
  ngn::CameraPictureRequest request = _request.photo;
  _capture->capturePhoto([sheet, request](CGImageRef image, NSDictionary *metadata, const std::string &error) {
    std::optional<ngn::CameraShot> shot;
    std::string failure = error;
    if (image != nullptr) {
      if (ngn::appkit::writePicture(image, request)) {
        shot = ngn::CameraShot{.width = static_cast<int>(CGImageGetWidth(image)), .height = static_cast<int>(CGImageGetHeight(image))};
      } else {
        failure = "the picture could not be saved";
      }
    }
    NSDictionary *exif = metadata[(__bridge NSString *)kCGImagePropertyExifDictionary];
    // Decided on the main queue, where a cancel is too: a photo answered after a cancel is not
    // kept.
    std::string path = request.path;
    dispatch_async(dispatch_get_main_queue(), ^{
      if (![sheet finish:{.photo = shot} exif:exif error:failure] && shot) {
        [NSFileManager.defaultManager removeItemAtPath:@(path.c_str()) error:nil];
      }
    });
  });
}

- (void)record:(id)sender {
  if (!_videoMode || !_shutter.enabled) {
    return;
  }
  if (_recording) {
    _stopping = YES;
    [self refresh];
    _capture->stopRecording();
    return;
  }
  _recording = YES;
  _recordingSince = CACurrentMediaTime();
  _elapsed.stringValue = elapsedText(0);
  __weak NGNCameraSheet *weakSheet = self;
  _clock = [NSTimer scheduledTimerWithTimeInterval:0.25
                                           repeats:YES
                                             block:^(NSTimer *timer) {
                                               [weakSheet showElapsed];
                                             }];
  [self refresh];
  NGNCameraSheet *sheet = self;
  _capture->startRecording(_request.video, [sheet](const std::string &error) {
    std::string failure = error;
    dispatch_async(dispatch_get_main_queue(), ^{
      [sheet recordingEnded:failure];
    });
  });
}

- (void)showElapsed {
  _elapsed.stringValue = elapsedText(CACurrentMediaTime() - _recordingSince);
}

// The movie is finished: at Stop, at the request's limit, or as the sheet went another way.
- (void)recordingEnded:(std::string)error {
  _recording = NO;
  _stopping = NO;
  [_clock invalidate];
  _clock = nil;
  NSString *path = @(_request.video.path.c_str());
  if (!_done) {
    // Cancelled while it recorded: nothing answers for the movie.
    [NSFileManager.defaultManager removeItemAtPath:path error:nil];
    return;
  }
  if (!error.empty()) {
    [self finish:{} exif:nil error:error];
    return;
  }
  auto clip = ngn::appkit::movieClip(_request.video.path);
  if (!clip) {
    [NSFileManager.defaultManager removeItemAtPath:path error:nil];
    [self finish:{} exif:nil error:"the video could not be read"];
    return;
  }
  [self finish:{.video = clip} exif:nil error:""];
}

- (void)cancel:(id)sender {
  [self finish:{} exif:nil error:""];
}

// The window going another way (its parent closed, say) is a cancel.
- (void)viewDidDisappear {
  [super viewDidDisappear];
  [self finish:{} exif:nil error:""];
}

// Answers once, stops the camera (and with it a recording) and lets the sheet go; NO when it was
// answered already.
- (BOOL)finish:(ngn::CameraTake)take exif:(NSDictionary *)exif error:(std::string)error {
  if (!_done) {
    return NO;
  }
  auto done = std::move(_done);
  _done = nullptr;
  [self refresh];
  _capture->stop();
  NSWindow *window = self.viewLoaded ? self.view.window : nil;
  if (window.sheetParent != nil) {
    [window.sheetParent endSheet:window];
  }
  done(std::move(take), exif, error);
  return YES;
}

@end

namespace ngn::appkit {

NSWindow *windowForSheet() {
  if (NSApp.keyWindow != nil) {
    return NSApp.keyWindow;
  }
  if (NSApp.mainWindow != nil) {
    return NSApp.mainWindow;
  }
  // An app that is not active has neither, as just after the OS asked for the microphone in a
  // window of its own: its front window that can hold a sheet.
  for (NSWindow *window in NSApp.orderedWindows) {
    if (window.visible && window.sheetParent == nil && window.attachedSheet == nil && window.canBecomeMainWindow) {
      return window;
    }
  }
  return nil;
}

namespace {

class SheetCamera final : public CameraSheet {
 public:
  void shoot(const CameraSheetRequest &request, std::function<void(CameraTake, const std::string &)> done) override {
    auto answer = std::make_shared<std::function<void(CameraTake, const std::string &)>>(std::move(done));
    CameraSheetRequest asked = request;
    dispatch_async(dispatch_get_main_queue(), ^{
      NSWindow *window = windowForSheet();
      if (window == nil) {
        (*answer)({}, "");
        return;
      }
      auto controller = std::make_shared<NGNCameraSheet *>(nil);
      std::string error;
      auto capture = startCapture(cameraFor("front"), error, [controller] { [*controller cameraRunning]; });
      if (!capture) {
        (*answer)({}, error);
        return;
      }
      NGNCameraSheet *sheet = [[NGNCameraSheet alloc] initWithCapture:capture
                                                              request:asked
                                                                 done:[answer, controller](CameraTake take, NSDictionary *exif, const std::string &failure) {
                                                                   *controller = nil;
                                                                   if (take.photo) {
                                                                     take.photo->exif = dynamicFrom(exif);
                                                                   }
                                                                   (*answer)(std::move(take), failure);
                                                                 }];
      *controller = sheet;
      [window beginSheet:pickerSheet(sheet, window) completionHandler:nil];
    });
  }
};

} // namespace

std::shared_ptr<CameraSheet> makeCameraSheet() {
  return std::make_shared<SheetCamera>();
}

} // namespace ngn::appkit
