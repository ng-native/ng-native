#import "camera-sheet.h"

#import "photo-library.h"
#import "system-access.h"

#import <ImageIO/ImageIO.h>

namespace {

// The bar under the preview that holds the buttons, and the room around them.
constexpr CGFloat kBar = 52;
constexpr CGFloat kInset = 20;

} // namespace

@implementation NGNCameraSheet {
  std::shared_ptr<ngn::appkit::SessionCapture> _capture;
  ngn::CameraPictureRequest _request;
  CameraSheetDone _done;
  BOOL _taking;
}

- (instancetype)initWithCapture:(std::shared_ptr<ngn::appkit::SessionCapture>)capture
                        request:(ngn::CameraPictureRequest)request
                           done:(CameraSheetDone)done {
  if ((self = [super initWithNibName:nil bundle:nil])) {
    _capture = std::move(capture);
    _request = std::move(request);
    _done = std::move(done);
  }
  return self;
}

- (void)loadView {
  NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 780, 560)];

  _preview = [AVCaptureVideoPreviewLayer layerWithSession:_capture->session()];
  _preview.videoGravity = AVLayerVideoGravityResizeAspectFill;
  _preview.backgroundColor = NSColor.blackColor.CGColor;
  // Mirrored, as a camera facing the user is shown on a Mac; the photo is not.
  AVCaptureConnection *connection = _preview.connection;
  if (connection.isVideoMirroringSupported) {
    connection.automaticallyAdjustsVideoMirroring = NO;
    connection.videoMirrored = YES;
  }
  NSView *preview = [[NSView alloc] initWithFrame:NSMakeRect(0, kBar, 780, 560 - kBar)];
  preview.layer = _preview;
  preview.wantsLayer = YES;
  preview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [preview setAccessibilityElement:YES];
  [preview setAccessibilityRole:NSAccessibilityImageRole];
  [preview setAccessibilityLabel:@"Camera preview"];
  [view addSubview:preview];

  // Take Photo is the default button, rightmost, as a dialog's action is; Cancel is beside it.
  _shutter = [NSButton buttonWithTitle:@"Take Photo" target:self action:@selector(takePhoto:)];
  _shutter.keyEquivalent = @"\r";
  _shutter.enabled = NO;
  _cancelButton = [NSButton buttonWithTitle:@"Cancel" target:self action:@selector(cancel:)];
  _cancelButton.keyEquivalent = @"\x1b";
  [_shutter sizeToFit];
  [_cancelButton sizeToFit];
  CGFloat width = std::max(_shutter.frame.size.width, _cancelButton.frame.size.width);
  CGFloat y = (kBar - _shutter.frame.size.height) / 2;
  _shutter.frame = NSMakeRect(780 - kInset - width, y, width, _shutter.frame.size.height);
  _cancelButton.frame = NSMakeRect(NSMinX(_shutter.frame) - 12 - width, y, width, _cancelButton.frame.size.height);
  for (NSButton *button in @[ _shutter, _cancelButton ]) {
    button.autoresizingMask = NSViewMinXMargin | NSViewMaxYMargin;
    [view addSubview:button];
  }
  self.view = view;
}

- (void)cameraRunning {
  if (!_taking && _done) {
    _shutter.enabled = YES;
  }
}

- (void)takePhoto:(id)sender {
  // Disabled until the camera runs, while a photo is taken, and once answered.
  if (!_shutter.enabled) {
    return;
  }
  _taking = YES;
  _shutter.enabled = NO;
  NGNCameraSheet *sheet = self;
  ngn::CameraPictureRequest request = _request;
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
    dispatch_async(dispatch_get_main_queue(), ^{
      [sheet finish:shot exif:exif error:failure];
    });
  });
}

- (void)cancel:(id)sender {
  [self finish:std::nullopt exif:nil error:""];
}

// The window going another way (its parent closed, say) is a cancel.
- (void)viewDidDisappear {
  [super viewDidDisappear];
  [self finish:std::nullopt exif:nil error:""];
}

// Answers once, stops the camera and lets the sheet go.
- (void)finish:(std::optional<ngn::CameraShot>)shot exif:(NSDictionary *)exif error:(std::string)error {
  if (!_done) {
    return;
  }
  auto done = std::move(_done);
  _done = nullptr;
  _shutter.enabled = NO;
  _capture->stop();
  NSWindow *window = self.viewLoaded ? self.view.window : nil;
  if (window.sheetParent != nil) {
    [window.sheetParent endSheet:window];
  }
  done(std::move(shot), exif, error);
}

@end

namespace ngn::appkit {

namespace {

class SheetCamera final : public CameraSheet {
 public:
  void shoot(const CameraPictureRequest &request, std::function<void(std::optional<CameraShot>, const std::string &)> done) override {
    auto answer = std::make_shared<std::function<void(std::optional<CameraShot>, const std::string &)>>(std::move(done));
    CameraPictureRequest asked = request;
    dispatch_async(dispatch_get_main_queue(), ^{
      NSWindow *window = NSApp.keyWindow != nil ? NSApp.keyWindow : NSApp.mainWindow;
      if (window == nil) {
        (*answer)(std::nullopt, "");
        return;
      }
      auto controller = std::make_shared<NGNCameraSheet *>(nil);
      std::string error;
      auto capture = startCapture(cameraFor("front"), error, [controller] { [*controller cameraRunning]; });
      if (!capture) {
        (*answer)(std::nullopt, error);
        return;
      }
      NGNCameraSheet *sheet = [[NGNCameraSheet alloc] initWithCapture:capture
                                                              request:asked
                                                                 done:[answer, controller](std::optional<CameraShot> shot, NSDictionary *exif, const std::string &failure) {
                                                                   *controller = nil;
                                                                   if (shot) {
                                                                     shot->exif = dynamicFrom(exif);
                                                                   }
                                                                   (*answer)(std::move(shot), failure);
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
