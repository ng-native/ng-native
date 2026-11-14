#import "camera.h"

#import <ImageIO/ImageIO.h>

// Answers one photo capture: the JPEG at its quality, written to its path.
@interface NGNPhotoCapture : NSObject <AVCapturePhotoCaptureDelegate>
- (instancetype)initWithQuality:(double)quality
                           path:(std::string)path
                           done:(std::function<void(int, int, const std::string &)>)done;
@end

@implementation NGNPhotoCapture {
  double _quality;
  std::string _path;
  std::function<void(int, int, const std::string &)> _done;
  NGNPhotoCapture *_keep;
}

- (instancetype)initWithQuality:(double)quality path:(std::string)path done:(std::function<void(int, int, const std::string &)>)done {
  if ((self = [super init])) {
    _quality = quality;
    _path = std::move(path);
    _done = std::move(done);
    _keep = self;
  }
  return self;
}

- (void)captureOutput:(AVCapturePhotoOutput *)output didFinishProcessingPhoto:(AVCapturePhoto *)photo error:(NSError *)error {
  auto done = std::move(_done);
  _keep = nil;
  CGImageRef image = error == nil ? photo.CGImageRepresentation : nullptr;
  if (image == nullptr) {
    done(0, 0, error != nil ? error.localizedDescription.UTF8String : "the camera gave no picture");
    return;
  }
  NSURL *url = [NSURL fileURLWithPath:@(_path.c_str())];
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.jpeg"), 1, nullptr);
  NSDictionary *properties = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @(_quality)};
  bool written = destination != nullptr;
  if (written) {
    CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
    written = CGImageDestinationFinalize(destination);
    CFRelease(destination);
  }
  if (!written) {
    done(0, 0, "the picture could not be saved");
    return;
  }
  done(static_cast<int>(CGImageGetWidth(image)), static_cast<int>(CGImageGetHeight(image)), "");
}

@end

namespace ngn::appkit {

namespace {

using Access = CameraHardware::Access;

Access accessOf(AVAuthorizationStatus status) {
  switch (status) {
    case AVAuthorizationStatusAuthorized: return Access::Granted;
    case AVAuthorizationStatusDenied: return Access::Denied;
    case AVAuthorizationStatusRestricted: return Access::Restricted;
    default: return Access::NotDetermined;
  }
}

// Whether the app's Info.plist says why it asks: without the string the OS ends the app.
bool explains() {
  id reason = NSBundle.mainBundle.infoDictionary[@"NSCameraUsageDescription"];
  return [reason isKindOfClass:NSString.class] && [reason length] > 0;
}

NSArray<AVCaptureDevice *> *cameras() {
  NSMutableArray<AVCaptureDeviceType> *types = [NSMutableArray arrayWithObject:AVCaptureDeviceTypeBuiltInWideAngleCamera];
  if (@available(macOS 14.0, *)) {
    [types addObject:AVCaptureDeviceTypeExternal];
    [types addObject:AVCaptureDeviceTypeContinuityCamera];
  }
  return [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types
                                                                mediaType:AVMediaTypeVideo
                                                                 position:AVCaptureDevicePositionUnspecified]
      .devices;
}

class AVHardware final : public CameraHardware {
 public:
  Access access() override {
    return accessOf([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]);
  }
  void requestAccess(std::function<void(Access)> done) override {
    if (!explains() || access() != Access::NotDetermined) {
      done(access());
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo
                             completionHandler:^(BOOL granted) { (*answer)(granted ? Access::Granted : Access::Denied); }];
  }
  bool hasCamera() override {
    return cameras().count > 0;
  }
};

class AVSessionCapture final : public SessionCapture {
 public:
  AVSessionCapture(AVCaptureSession *session, AVCapturePhotoOutput *output) : session_(session), output_(output) {}
  ~AVSessionCapture() override {
    stop();
  }
  AVCaptureSession *session() const override {
    return session_;
  }
  void stop() override {
    if (session_.running) {
      [session_ stopRunning];
    }
  }
  void takePicture(double quality, const std::string &path, std::function<void(int, int, const std::string &)> done) override {
    if (!session_.running) {
      done(0, 0, "the camera is not running");
      return;
    }
    NGNPhotoCapture *capture = [[NGNPhotoCapture alloc] initWithQuality:quality path:path done:std::move(done)];
    [output_ capturePhotoWithSettings:[AVCapturePhotoSettings photoSettings] delegate:capture];
  }

 private:
  AVCaptureSession *session_;
  AVCapturePhotoOutput *output_;
};

} // namespace

std::shared_ptr<CameraHardware> makeCameraHardware() {
  return std::make_shared<AVHardware>();
}

AVCaptureDevice *cameraFor(const std::string &facing) {
  NSArray<AVCaptureDevice *> *all = cameras();
  // A Mac's built-in camera faces the user; `front` and `back` both mean it.
  for (AVCaptureDevice *device in all) {
    if ([device.deviceType isEqualToString:AVCaptureDeviceTypeBuiltInWideAngleCamera]) {
      return device;
    }
  }
  return all.firstObject;
}

std::shared_ptr<SessionCapture> startCapture(AVCaptureDevice *device, std::string &error) {
  if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] != AVAuthorizationStatusAuthorized) {
    error = cameraMountError(CameraMount::NotPermitted);
    return nullptr;
  }
  if (device == nil) {
    error = cameraMountError(CameraMount::NoCamera);
    return nullptr;
  }
  NSError *failure = nil;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&failure];
  AVCaptureSession *session = [AVCaptureSession new];
  AVCapturePhotoOutput *output = [AVCapturePhotoOutput new];
  [session beginConfiguration];
  session.sessionPreset = AVCaptureSessionPresetPhoto;
  bool ready = input != nil && [session canAddInput:input] && [session canAddOutput:output];
  if (ready) {
    [session addInput:input];
    [session addOutput:output];
  }
  [session commitConfiguration];
  if (!ready) {
    error = std::string("Camera could not be started - ") +
        (failure != nil ? failure.localizedDescription.UTF8String : "the camera cannot be used");
    return nullptr;
  }
  [session startRunning];
  return std::make_shared<AVSessionCapture>(session, output);
}

} // namespace ngn::appkit
