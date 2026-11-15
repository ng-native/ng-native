#include "audio.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>

#include <atomic>

// Calls `changed` as its player item loads or fails and as its player starts, stalls or stops.
@interface NGNAudioObserver : NSObject
- (instancetype)initWithPlayer:(AVPlayer *)player changed:(void (^)(void))changed;
- (void)stop;
@end

@implementation NGNAudioObserver {
  AVPlayer *_player;
  void (^_changed)(void);
  BOOL _observing;
}

- (instancetype)initWithPlayer:(AVPlayer *)player changed:(void (^)(void))changed {
  if ((self = [super init])) {
    _player = player;
    _changed = [changed copy];
    [player addObserver:self forKeyPath:@"currentItem.status" options:0 context:nil];
    [player addObserver:self forKeyPath:@"timeControlStatus" options:0 context:nil];
    _observing = YES;
  }
  return self;
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  _changed();
}

- (void)stop {
  if (_observing) {
    [_player removeObserver:self forKeyPath:@"currentItem.status"];
    [_player removeObserver:self forKeyPath:@"timeControlStatus"];
    _observing = NO;
  }
}

@end

namespace ngn::appkit {

namespace {

using Change = AudioOutput::Change;

class AVTrack final : public AudioTrack {
 public:
  AVTrack(NSURL *url, double interval, std::function<void(Change)> changed) {
    auto alive = alive_;
    auto send = std::make_shared<std::function<void(Change)>>(std::move(changed));
    auto call = [alive, send](Change change) {
      if (alive->load()) {
        (*send)(change);
      }
    };
    queue_ = dispatch_queue_create("ngn.audio", DISPATCH_QUEUE_SERIAL);
    item_ = [AVPlayerItem playerItemWithURL:url];
    // expo-audio corrects the pitch at any rate.
    item_.audioTimePitchAlgorithm = AVAudioTimePitchAlgorithmSpectral;
    player_ = [AVPlayer playerWithPlayerItem:item_];
    player_.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    observer_ = [[NGNAudioObserver alloc] initWithPlayer:player_ changed:^{ call(Change::State); }];
    time_ = [player_ addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(interval, 1000)
                                                  queue:queue_
                                             usingBlock:^(CMTime) { call(Change::State); }];
    end_ = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification
                                                           object:item_
                                                            queue:nil
                                                       usingBlock:^(NSNotification *) { call(Change::Ended); }];
  }

  ~AVTrack() override {
    alive_->store(false);
    [observer_ stop];
    [player_ removeTimeObserver:time_];
    [NSNotificationCenter.defaultCenter removeObserver:end_];
    [player_ pause];
    [player_ replaceCurrentItemWithPlayerItem:nil];
  }

  TrackState state() override {
    TrackState out;
    switch (item_.status) {
      case AVPlayerItemStatusReadyToPlay: out.load = TrackState::Load::Ready; break;
      case AVPlayerItemStatusFailed:
        out.load = TrackState::Load::Failed;
        out.error = item_.error != nil ? item_.error.localizedDescription.UTF8String : "The audio did not load";
        break;
      default: break;
    }
    auto control = player_.timeControlStatus;
    out.playing = control != AVPlayerTimeControlStatusPaused;
    out.buffering = control == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate;
    out.currentTime = seconds(player_.currentTime);
    out.duration = seconds(item_.duration);
    return out;
  }

  void play(double rate) override {
    if (rate <= 0) {
      [player_ pause];
      return;
    }
    player_.rate = static_cast<float>(rate);
  }

  void pause() override {
    [player_ pause];
  }

  void seek(double to, std::function<void()> done) override {
    auto finish = std::make_shared<std::function<void()>>(std::move(done));
    [player_ seekToTime:CMTimeMakeWithSeconds(to, 1000)
          toleranceBefore:kCMTimeZero
           toleranceAfter:kCMTimeZero
        completionHandler:^(BOOL) { (*finish)(); }];
  }

  void setRate(double rate) override {
    player_.rate = static_cast<float>(rate);
  }

  void setVolume(double volume) override {
    player_.volume = static_cast<float>(volume);
  }

 private:
  static double seconds(CMTime time) {
    if (!CMTIME_IS_NUMERIC(time)) {
      return 0;
    }
    double value = CMTimeGetSeconds(time);
    return value > 0 ? value : 0;
  }

  std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
  dispatch_queue_t queue_;
  AVPlayerItem *item_;
  AVPlayer *player_;
  NGNAudioObserver *observer_;
  id time_;
  id end_;
};

class AVOutput final : public AudioOutput {
 public:
  std::unique_ptr<AudioTrack> open(const std::string &uri, double interval, std::function<void(Change)> changed) override {
    NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:uri.c_str()]];
    if (url == nil) {
      // A uri NSURL cannot read is a track that fails to load.
      url = [NSURL URLWithString:@"invalid:"];
    }
    return std::make_unique<AVTrack>(url, interval > 0 ? interval : 0.5, std::move(changed));
  }
};

class AVRecording final : public AudioRecording {
 public:
  explicit AVRecording(AVAudioRecorder *recorder) : recorder_(recorder) {}
  ~AVRecording() override {
    [recorder_ stop];
  }
  bool record() override {
    return [recorder_ record];
  }
  void pause() override {
    [recorder_ pause];
  }
  void stop() override {
    [recorder_ stop];
  }
  bool recording() override {
    return recorder_.recording;
  }
  double currentTime() override {
    return recorder_.currentTime;
  }
  std::optional<double> metering() override {
    if (!recorder_.meteringEnabled) {
      return std::nullopt;
    }
    [recorder_ updateMeters];
    return [recorder_ averagePowerForChannel:0];
  }

 private:
  AVAudioRecorder *recorder_;
};

AudioInput::Access accessOf(AVAuthorizationStatus status) {
  switch (status) {
    case AVAuthorizationStatusAuthorized: return AudioInput::Access::Granted;
    case AVAuthorizationStatusDenied: return AudioInput::Access::Denied;
    case AVAuthorizationStatusRestricted: return AudioInput::Access::Restricted;
    default: return AudioInput::Access::NotDetermined;
  }
}

// Whether the app's Info.plist says why it asks: without the string the OS ends the app.
bool explains() {
  id reason = NSBundle.mainBundle.infoDictionary[@"NSMicrophoneUsageDescription"];
  return [reason isKindOfClass:NSString.class] && [reason length] > 0;
}

NSDictionary *settingsOf(const RecordingSettings &settings) {
  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  AudioFormatID format = settings.format == "pcm" ? kAudioFormatLinearPCM : settings.format == "alac" ? kAudioFormatAppleLossless : kAudioFormatMPEG4AAC;
  out[AVFormatIDKey] = @(format);
  out[AVSampleRateKey] = @(settings.sampleRate);
  out[AVNumberOfChannelsKey] = @(settings.channels);
  out[AVEncoderAudioQualityKey] = @(settings.quality);
  if (format == kAudioFormatMPEG4AAC) {
    out[AVEncoderBitRateKey] = @(settings.bitRate);
  }
  if (format == kAudioFormatLinearPCM) {
    out[AVLinearPCMBitDepthKey] = @(settings.bitDepth);
    out[AVLinearPCMIsFloatKey] = @NO;
    out[AVLinearPCMIsBigEndianKey] = @NO;
  }
  return out;
}

class AVInput final : public AudioInput {
 public:
  Access access() override {
    return accessOf([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]);
  }

  void requestAccess(std::function<void(Access)> done) override {
    if (!explains() || access() != Access::NotDetermined) {
      done(access());
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                             completionHandler:^(BOOL granted) { (*answer)(granted ? Access::Granted : Access::Denied); }];
  }

  bool hasMicrophone() override {
    return [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio] != nil;
  }

  std::unique_ptr<AudioRecording> prepare(const std::string &path, const RecordingSettings &settings, std::string &error) override {
    NSString *file = [NSString stringWithUTF8String:path.c_str()];
    NSError *failure = nil;
    [NSFileManager.defaultManager createDirectoryAtPath:file.stringByDeletingLastPathComponent
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:&failure];
    AVAudioRecorder *recorder = [[AVAudioRecorder alloc] initWithURL:[NSURL fileURLWithPath:file] settings:settingsOf(settings) error:&failure];
    if (recorder == nil || ![recorder prepareToRecord]) {
      error = failure != nil ? failure.localizedDescription.UTF8String : "the recorder did not prepare";
      return nullptr;
    }
    recorder.meteringEnabled = settings.metering;
    return std::make_unique<AVRecording>(recorder);
  }
};

} // namespace

std::shared_ptr<AudioOutput> makeAudioOutput() {
  return std::make_shared<AVOutput>();
}

std::shared_ptr<AudioInput> makeAudioInput() {
  return std::make_shared<AVInput>();
}

} // namespace ngn::appkit
