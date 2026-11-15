#import "camera.h"

#import <ImageIO/ImageIO.h>

#include <atomic>

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

// Answers one movie recording once its file is finished. A recording a limit ended is finished
// well: AVFoundation reports it as an error that says so.
@interface NGNMovieRecording : NSObject <AVCaptureFileOutputRecordingDelegate>
- (instancetype)initWithDone:(std::function<void(const std::string &)>)done;
@end

@implementation NGNMovieRecording {
  std::function<void(const std::string &)> _done;
  // The movie output does not keep its delegate, so it keeps itself until the recording ends.
  NGNMovieRecording *_keep;
}

- (instancetype)initWithDone:(std::function<void(const std::string &)>)done {
  if ((self = [super init])) {
    _done = std::move(done);
    _keep = self;
  }
  return self;
}

- (void)captureOutput:(AVCaptureFileOutput *)output
    didFinishRecordingToOutputFileAtURL:(NSURL *)url
                        fromConnections:(NSArray<AVCaptureConnection *> *)connections
                                  error:(NSError *)error {
  bool finished = error == nil || [error.userInfo[AVErrorRecordingSuccessfullyFinishedKey] boolValue];
  auto done = std::move(_done);
  _keep = nil;
  if (done) {
    const char *reason = error.localizedDescription.UTF8String;
    done(finished ? "" : (reason != nullptr ? reason : "the recording failed"));
  }
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
    return cameraFor("front") != nil;
  }
  bool microphoneAllowed() override {
    return [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusAuthorized &&
        [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio] != nil;
  }
};

// The codec expo-camera names, if AVFoundation has it.
AVVideoCodecType codecOf(const std::string &name) {
  if (name == "hvc1") return AVVideoCodecTypeHEVC;
  if (name == "avc1") return AVVideoCodecTypeH264;
  if (name == "jpeg") return AVVideoCodecTypeJPEG;
  if (name == "apcn") return AVVideoCodecTypeAppleProRes422;
  if (name == "ap4h") return AVVideoCodecTypeAppleProRes4444;
  return nil;
}

class AVSessionCapture final : public SessionCapture {
 public:
  AVSessionCapture(AVCaptureSession *session, AVCapturePhotoOutput *output)
      : session_(session), output_(output), queue_(dispatch_queue_create("ngn.camera.session", DISPATCH_QUEUE_SERIAL)) {}
  ~AVSessionCapture() override {
    stop();
  }
  AVCaptureSession *session() const override {
    return session_;
  }
  void start(std::function<void()> running) override {
    AVCaptureSession *session = session_;
    auto ready = std::make_shared<std::function<void()>>(std::move(running));
    dispatch_async(queue_, ^{
      [session startRunning];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (*ready) {
          (*ready)();
        }
      });
    });
  }
  void stop() override {
    stopRecording();
    // The block holds the session, so it stops after this capture has gone.
    AVCaptureSession *session = session_;
    dispatch_async(queue_, ^{
      if (session.running) {
        [session stopRunning];
      }
    });
  }

  // The movie output and, with sound, the microphone are added to the session for the recording
  // and taken off after it, on the session's queue, since configuring a running session blocks.
  void startRecording(const CameraRecordingRequest &asked, std::function<void(const std::string &)> done) override {
    // The block runs later on the session's queue: a reference it captured would be to the
    // caller's request, gone by then.
    CameraRecordingRequest request = asked;
    if (!session_.running) {
      done("the camera is not running");
      return;
    }
    if (recording_->exchange(true)) {
      done("a recording is already in progress");
      return;
    }
    AVCaptureSession *session = session_;
    auto recording = recording_;
    auto movieHolder = movie_;
    auto answer = std::make_shared<std::function<void(const std::string &)>>(std::move(done));
    dispatch_queue_t queue = queue_;
    dispatch_async(queue_, ^{
      [session beginConfiguration];
      NSString *preset = session.sessionPreset;
      if ([session canSetSessionPreset:AVCaptureSessionPresetHigh]) {
        session.sessionPreset = AVCaptureSessionPresetHigh;
      }
      AVCaptureDeviceInput *microphone = nil;
      // Never without the microphone allowed: a microphone input in a session asks for it.
      if (request.sound &&
          [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusAuthorized) {
        AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
        microphone = device != nil ? [AVCaptureDeviceInput deviceInputWithDevice:device error:nil] : nil;
        if (microphone != nil && [session canAddInput:microphone]) {
          [session addInput:microphone];
        } else {
          microphone = nil;
        }
      }
      AVCaptureMovieFileOutput *movie = [AVCaptureMovieFileOutput new];
      bool added = [session canAddOutput:movie];
      if (added) {
        [session addOutput:movie];
      }
      [session commitConfiguration];
      void (^takeDown)(void) = ^{
        [session beginConfiguration];
        if (added) {
          [session removeOutput:movie];
        }
        if (microphone != nil) {
          [session removeInput:microphone];
        }
        if ([session canSetSessionPreset:preset]) {
          session.sessionPreset = preset;
        }
        [session commitConfiguration];
        *movieHolder = nil;
        recording->store(false);
      };
      AVCaptureConnection *video = added ? [movie connectionWithMediaType:AVMediaTypeVideo] : nil;
      if (video == nil || !video.active || !video.enabled) {
        takeDown();
        (*answer)("the camera gives no video to record");
        return;
      }
      // A codec this Mac cannot write is refused by an exception; the default stays.
      if (AVVideoCodecType codec = codecOf(request.codec)) {
        @try {
          [movie setOutputSettings:@{AVVideoCodecKey : codec} forConnection:video];
        } @catch (NSException *) {
        }
      }
      movie.maxRecordedDuration = request.maxDuration > 0 ? CMTimeMakeWithSeconds(request.maxDuration, 600) : kCMTimeInvalid;
      movie.maxRecordedFileSize = static_cast<int64_t>(request.maxFileSize);
      NSURL *url = [NSURL fileURLWithPath:@(request.path.c_str())];
      [NSFileManager.defaultManager removeItemAtURL:url error:nil];
      *movieHolder = movie;
      // The answer follows the take-down, so a recording asked for at once finds none running.
      NGNMovieRecording *delegate = [[NGNMovieRecording alloc] initWithDone:[answer, takeDown, queue](const std::string &error) {
        std::string message = error;
        dispatch_async(queue, ^{
          takeDown();
          (*answer)(message);
        });
      }];
      [movie startRecordingToOutputFileURL:url recordingDelegate:delegate];
    });
  }

  void stopRecording() override {
    auto movieHolder = movie_;
    dispatch_async(queue_, ^{
      [*movieHolder stopRecording];
    });
  }

  bool recording() const override {
    return recording_->load();
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
  dispatch_queue_t queue_;
  // Shared with the blocks on the queue, which can outlive the capture: whether a recording runs,
  // and its output while it does (set and read on the queue).
  std::shared_ptr<std::atomic<bool>> recording_ = std::make_shared<std::atomic<bool>>(false);
  std::shared_ptr<AVCaptureMovieFileOutput *> movie_ = std::make_shared<AVCaptureMovieFileOutput *>(nil);
};

} // namespace

std::shared_ptr<CameraHardware> makeCameraHardware() {
  return std::make_shared<AVHardware>();
}

AVCaptureDevice *cameraFor(const std::string &facing) {
  NSArray<AVCaptureDevice *> *all = cameras();
  // A Mac's built-in camera faces the user; `front` and `back` both mean it. With the lid closed it
  // is suspended and gives no frames, so another camera is taken, or none.
  std::vector<CameraCandidate> candidates;
  for (AVCaptureDevice *device in all) {
    candidates.push_back({.builtIn = [device.deviceType isEqualToString:AVCaptureDeviceTypeBuiltInWideAngleCamera],
                          .suspended = static_cast<bool>(device.suspended)});
  }
  int chosen = chooseCamera(candidates);
  return chosen < 0 ? nil : all[static_cast<NSUInteger>(chosen)];
}

std::shared_ptr<SessionCapture> sessionCapture(AVCaptureSession *session, AVCapturePhotoOutput *output) {
  return std::make_shared<AVSessionCapture>(session, output);
}

std::shared_ptr<SessionCapture> startCapture(AVCaptureDevice *device, std::string &error, std::function<void()> running) {
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
  auto capture = sessionCapture(session, output);
  capture->start(std::move(running));
  return capture;
}

} // namespace ngn::appkit
