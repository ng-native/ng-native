#import "camera.h"

#import <ImageIO/ImageIO.h>

#include <atomic>
#include <cmath>
#include <optional>

// Answers one photo capture: its image and the camera's metadata, or why there is none.
@interface NGNPhotoCapture : NSObject <AVCapturePhotoCaptureDelegate>
- (instancetype)initWithDone:(ngn::appkit::PhotoDone)done;
// Answers that no photo is coming, for a capture the output refused.
- (void)abandon:(const char *)reason;
@end

@implementation NGNPhotoCapture {
  ngn::appkit::PhotoDone _done;
  NGNPhotoCapture *_keep;
}

- (instancetype)initWithDone:(ngn::appkit::PhotoDone)done {
  if ((self = [super init])) {
    _done = std::move(done);
    _keep = self;
  }
  return self;
}

- (void)abandon:(const char *)reason {
  auto done = std::move(_done);
  _keep = nil;
  if (done) {
    done(nullptr, nil, reason);
  }
}

- (void)captureOutput:(AVCapturePhotoOutput *)output didFinishProcessingPhoto:(AVCapturePhoto *)photo error:(NSError *)error {
  auto done = std::move(_done);
  _keep = nil;
  CGImageRef image = error == nil ? photo.CGImageRepresentation : nullptr;
  if (image == nullptr) {
    done(nullptr, nil, error != nil ? error.localizedDescription.UTF8String : "the camera gave no picture");
    return;
  }
  // macOS has no AVCapturePhoto.metadata: the photo's own file carries it.
  NSDictionary *metadata = nil;
  if (NSData *data = photo.fileDataRepresentation) {
    if (CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr)) {
      metadata = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr));
      CFRelease(source);
    }
  }
  done(image, metadata, "");
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

// The session preset a recording request names (CameraRecordingRequest::preset).
AVCaptureSessionPreset presetOf(const std::string &name) {
  if (name == "Medium") return AVCaptureSessionPresetMedium;
  if (name == "Low") return AVCaptureSessionPresetLow;
  if (name == "640x480") return AVCaptureSessionPreset640x480;
  if (name == "iFrame1280x720") return AVCaptureSessionPresetiFrame1280x720;
  if (name == "iFrame960x540") return AVCaptureSessionPresetiFrame960x540;
  return AVCaptureSessionPresetHigh;
}

// A session set up to record: the movie output and microphone added to it, and the preset it had
// before. Only touched on the session's queue.
struct RecordingSetup {
  AVCaptureMovieFileOutput *movie{nil};
  AVCaptureDeviceInput *microphone{nil};
  NSString *before{nil};
  std::string preset;
  bool sound{false};
};

// Takes the setup off the session and puts its preset back.
void takeDown(AVCaptureSession *session, std::optional<RecordingSetup> &setup) {
  if (!setup) {
    return;
  }
  [session beginConfiguration];
  if (setup->movie != nil) {
    [session removeOutput:setup->movie];
  }
  if (setup->microphone != nil) {
    [session removeInput:setup->microphone];
  }
  if ([session canSetSessionPreset:setup->before]) {
    session.sessionPreset = setup->before;
  }
  [session commitConfiguration];
  setup.reset();
}

// Sets the session up for `request`, unless it already is.
void setUp(AVCaptureSession *session, const CameraRecordingRequest &request, std::optional<RecordingSetup> &setup) {
  if (setup && setup->preset == request.preset && setup->sound == request.sound) {
    return;
  }
  takeDown(session, setup);
  RecordingSetup made{.before = session.sessionPreset, .preset = request.preset, .sound = request.sound};
  [session beginConfiguration];
  // The preset asked for, or High when this camera has no such preset.
  AVCaptureSessionPreset recordAt = presetOf(request.preset);
  if (![session canSetSessionPreset:recordAt]) {
    recordAt = AVCaptureSessionPresetHigh;
  }
  if ([session canSetSessionPreset:recordAt]) {
    session.sessionPreset = recordAt;
  }
  // Never without the microphone allowed: a microphone input in a session asks for it.
  if (request.sound && [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] == AVAuthorizationStatusAuthorized) {
    AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
    AVCaptureDeviceInput *microphone = device != nil ? [AVCaptureDeviceInput deviceInputWithDevice:device error:nil] : nil;
    if (microphone != nil && [session canAddInput:microphone]) {
      [session addInput:microphone];
      made.microphone = microphone;
    }
  }
  AVCaptureMovieFileOutput *movie = [AVCaptureMovieFileOutput new];
  if ([session canAddOutput:movie]) {
    [session addOutput:movie];
    made.movie = movie;
  }
  [session commitConfiguration];
  setup = made;
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

  // Reconfiguring a running session restarts the camera's stream, which takes it a moment, so a
  // recording set up only as it starts begins late.
  void prepareRecording(const CameraRecordingRequest &asked) override {
    CameraRecordingRequest request = asked;
    AVCaptureSession *session = session_;
    auto setup = setup_;
    auto recording = recording_;
    dispatch_async(queue_, ^{
      if (!recording->load()) {
        setUp(session, request, *setup);
      }
    });
  }
  void unprepareRecording() override {
    AVCaptureSession *session = session_;
    auto setup = setup_;
    auto recording = recording_;
    dispatch_async(queue_, ^{
      if (!recording->load()) {
        takeDown(session, *setup);
      }
    });
  }

  // The movie output and, with sound, the microphone are on the session for the recording (added
  // now unless prepareRecording added them) and taken off after it, on the session's queue, since
  // configuring a running session blocks.
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
    auto setup = setup_;
    auto answer = std::make_shared<std::function<void(const std::string &)>>(std::move(done));
    dispatch_queue_t queue = queue_;
    dispatch_async(queue_, ^{
      setUp(session, request, *setup);
      AVCaptureMovieFileOutput *movie = (*setup)->movie;
      void (^finished)(void) = ^{
        takeDown(session, *setup);
        *movieHolder = nil;
        recording->store(false);
      };
      AVCaptureConnection *video = movie != nil ? [movie connectionWithMediaType:AVMediaTypeVideo] : nil;
      if (video == nil || !video.active || !video.enabled) {
        finished();
        (*answer)("the camera gives no video to record");
        return;
      }
      // The movie is never mirrored, as on iOS, whatever its preview shows.
      if (video.isVideoMirroringSupported) {
        video.automaticallyAdjustsVideoMirroring = NO;
        video.videoMirrored = NO;
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
      NGNMovieRecording *delegate = [[NGNMovieRecording alloc] initWithDone:[answer, finished, queue](const std::string &error) {
        std::string message = error;
        dispatch_async(queue, ^{
          finished();
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
  void capturePhoto(PhotoDone done) override {
    if (!session_.running) {
      done(nullptr, nil, "the camera is not running");
      return;
    }
    // On the session's queue, after any change to the session queued before it (a recording's setup
    // coming down), which a still taken mid-change would find with no video to take.
    auto answer = std::make_shared<PhotoDone>(std::move(done));
    AVCaptureSession *session = session_;
    AVCapturePhotoOutput *output = output_;
    dispatch_async(queue_, ^{
      if (!session.running) {
        (*answer)(nullptr, nil, "the camera is not running");
        return;
      }
      NGNPhotoCapture *capture = [[NGNPhotoCapture alloc] initWithDone:*answer];
      @try {
        [output capturePhotoWithSettings:[AVCapturePhotoSettings photoSettings] delegate:capture];
      } @catch (NSException *exception) {
        // The output refuses with no active video connection; the delegate never hears.
        const char *reason = exception.reason.UTF8String;
        [capture abandon:reason != nullptr ? reason : "the camera gave no picture"];
      }
    });
  }

 private:
  AVCaptureSession *session_;
  AVCapturePhotoOutput *output_;
  dispatch_queue_t queue_;
  // Shared with the blocks on the queue, which can outlive the capture: whether a recording runs,
  // and its output while it does (set and read on the queue).
  std::shared_ptr<std::atomic<bool>> recording_ = std::make_shared<std::atomic<bool>>(false);
  std::shared_ptr<AVCaptureMovieFileOutput *> movie_ = std::make_shared<AVCaptureMovieFileOutput *>(nil);
  // What the session is set up to record with, prepared or for the recording running.
  std::shared_ptr<std::optional<RecordingSetup>> setup_ = std::make_shared<std::optional<RecordingSetup>>();
};

} // namespace

void SessionCapture::takePicture(const CameraPictureRequest &request, std::function<void(int, int, const std::string &)> done) {
  capturePhoto([request, done = std::move(done)](CGImageRef image, NSDictionary *, const std::string &error) {
    if (image == nullptr) {
      done(0, 0, error);
    } else if (!writePicture(image, request)) {
      done(0, 0, "the picture could not be saved");
    } else {
      done(static_cast<int>(CGImageGetWidth(image)), static_cast<int>(CGImageGetHeight(image)), "");
    }
  });
}

bool writePicture(CGImageRef image, const CameraPictureRequest &request) {
  bool png = request.format == "png";
  NSURL *url = [NSURL fileURLWithPath:@(request.path.c_str())];
  CGImageDestinationRef destination =
      CGImageDestinationCreateWithURL((__bridge CFURLRef)url, png ? CFSTR("public.png") : CFSTR("public.jpeg"), 1, nullptr);
  if (destination == nullptr) {
    return false;
  }
  // A PNG is lossless, so the quality is a JPEG's only, as on iOS.
  NSDictionary *properties = png ? @{} : @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @(request.quality)};
  CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
  bool written = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  return written;
}

std::optional<CameraClip> movieClip(const std::string &path) {
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:@(path.c_str())] options:nil];
  AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
  if (track == nil) {
    return std::nullopt;
  }
  // A track turned a quarter is its size turned too, which the transform's sign would make negative.
  CGSize size = CGSizeApplyAffineTransform(track.naturalSize, track.preferredTransform);
  return CameraClip{.width = static_cast<int>(std::lround(std::fabs(size.width))),
                    .height = static_cast<int>(std::lround(std::fabs(size.height))),
                    .duration = CMTimeGetSeconds(asset.duration) * 1000};
}

std::shared_ptr<CameraHardware> makeCameraHardware() {
  return std::make_shared<AVHardware>();
}

AVCaptureDevice *cameraFor(const std::string &facing) {
  NSArray<AVCaptureDevice *> *all = cameras();
  // A Mac's built-in camera faces the user; `front` and `back` both mean it. With the lid closed it
  // is suspended and gives no frames, so another camera is taken, or none.
  std::vector<CameraCandidate> candidates;
  for (AVCaptureDevice *device in all) {
    candidates.push_back({.builtIn = static_cast<bool>([device.deviceType isEqualToString:AVCaptureDeviceTypeBuiltInWideAngleCamera]),
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
