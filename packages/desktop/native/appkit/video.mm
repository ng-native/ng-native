#include "video.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>

#include <atomic>
#include <mutex>

namespace {

using Change = ngn::VideoPlayback::Change;

NSMapTable<NSNumber *, AVPlayer *> *players() {
  static NSMapTable *table = [NSMapTable strongToWeakObjectsMapTable];
  return table;
}

double seconds(CMTime time) {
  if (!CMTIME_IS_NUMERIC(time)) {
    return 0;
  }
  double value = CMTimeGetSeconds(time);
  return value > 0 ? value : 0;
}

} // namespace

AVPlayer *NGNVideoPlayerFor(int id) {
  @synchronized(players()) {
    return [players() objectForKey:@(id)];
  }
}

// Calls `changed` as its item loads or fails and as its player starts, stalls or stops.
@interface NGNVideoObserver : NSObject
- (instancetype)initWithPlayer:(AVPlayer *)player changed:(void (^)(void))changed;
- (void)stop;
@end

@implementation NGNVideoObserver {
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
    [player addObserver:self forKeyPath:@"currentItem.playbackBufferEmpty" options:0 context:nil];
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
    [_player removeObserver:self forKeyPath:@"currentItem.playbackBufferEmpty"];
    _observing = NO;
  }
}

@end

namespace ngn::appkit {

namespace {

class AVPlayback final : public VideoPlayback {
 public:
  explicit AVPlayback(int id) : id_(id) {
    queue_ = dispatch_queue_create("ngn.video", DISPATCH_QUEUE_SERIAL);
    player_ = [[AVPlayer alloc] init];
    player_.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    @synchronized(players()) {
      [players() setObject:player_ forKey:@(id)];
    }
  }

  ~AVPlayback() override {
    unload();
    stopTimeUpdates();
    [player_ pause];
    [player_ replaceCurrentItemWithPlayerItem:nil];
    @synchronized(players()) {
      if ([players() objectForKey:@(id_)] == player_) {
        [players() removeObjectForKey:@(id_)];
      }
    }
  }

  void load(const std::optional<std::string> &uri, std::function<void(Change)> changed) override {
    unload();
    auto alive = std::make_shared<std::atomic<bool>>(true);
    auto send = std::make_shared<std::function<void(Change)>>(std::move(changed));
    auto call = [alive, send](Change change) {
      if (alive->load()) {
        (*send)(change);
      }
    };
    {
      std::lock_guard lock(mutex_);
      alive_ = alive;
      call_ = call;
    }
    if (!uri) {
      [player_ replaceCurrentItemWithPlayerItem:nil];
      return;
    }
    NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:uri->c_str()]];
    // A uri NSURL cannot read is a source that fails to load.
    item_ = [AVPlayerItem playerItemWithURL:url != nil ? url : [NSURL URLWithString:@"invalid:"]];
    item_.audioTimePitchAlgorithm = pitch_ ? AVAudioTimePitchAlgorithmSpectral : AVAudioTimePitchAlgorithmVarispeed;
    [player_ replaceCurrentItemWithPlayerItem:item_];
    observer_ = [[NGNVideoObserver alloc] initWithPlayer:player_ changed:^{ call(Change::State); }];
    end_ = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification
                                                           object:item_
                                                            queue:nil
                                                       usingBlock:^(NSNotification *) { call(Change::Ended); }];
  }

  VideoState state() override {
    VideoState out;
    AVPlayerItem *item = item_;
    if (item == nil) {
      return out;
    }
    switch (item.status) {
      case AVPlayerItemStatusReadyToPlay: out.load = VideoState::Load::Ready; break;
      case AVPlayerItemStatusFailed:
        out.load = VideoState::Load::Failed;
        out.error = item.error != nil ? item.error.localizedDescription.UTF8String : "The video did not load";
        break;
      default: break;
    }
    auto control = player_.timeControlStatus;
    out.playing = control == AVPlayerTimeControlStatusPlaying;
    out.buffering = control == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate;
    double now = seconds(player_.currentTime);
    out.currentTime = now;
    out.duration = seconds(item.duration);
    for (NSValue *value in item.loadedTimeRanges) {
      CMTimeRange range = value.CMTimeRangeValue;
      double start = seconds(range.start);
      double end = start + seconds(range.duration);
      if (start <= now && now <= end) {
        out.bufferedPosition = end;
      }
    }
    return out;
  }

  void play(double rate) override {
    if (rate <= 0) {
      [player_ pause];
      return;
    }
    player_.defaultRate = static_cast<float>(rate);
    [player_ play];
  }

  void pause() override {
    [player_ pause];
  }

  void seek(double to, std::function<void()> done) override {
    auto finish = std::make_shared<std::function<void()>>(std::move(done));
    [player_ seekToTime:CMTimeMakeWithSeconds(to, 600)
          toleranceBefore:kCMTimeZero
           toleranceAfter:kCMTimeZero
        completionHandler:^(BOOL) { (*finish)(); }];
  }

  void setRate(double rate) override {
    if (rate <= 0) {
      return;
    }
    player_.defaultRate = static_cast<float>(rate);
    // Setting the rate of a player that is paused would start it.
    if (player_.rate != 0) {
      player_.rate = static_cast<float>(rate);
    }
  }

  void setVolume(double volume) override {
    player_.volume = static_cast<float>(volume);
  }

  void setMuted(bool muted) override {
    player_.muted = muted;
  }

  void setPreservesPitch(bool preserves) override {
    pitch_ = preserves;
    item_.audioTimePitchAlgorithm = preserves ? AVAudioTimePitchAlgorithmSpectral : AVAudioTimePitchAlgorithmVarispeed;
  }

  void setTimeUpdates(double interval) override {
    stopTimeUpdates();
    if (interval <= 0) {
      return;
    }
    auto *self = this;
    time_ = [player_ addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(interval, 600)
                                                  queue:queue_
                                             usingBlock:^(CMTime) { self->sendTime(); }];
  }

 private:
  void sendTime() {
    std::function<void(Change)> call;
    {
      std::lock_guard lock(mutex_);
      call = call_;
    }
    if (call && player_.timeControlStatus == AVPlayerTimeControlStatusPlaying) {
      call(Change::Time);
    }
  }

  void stopTimeUpdates() {
    if (time_ != nil) {
      [player_ removeTimeObserver:time_];
      time_ = nil;
      // A block already queued finishes before the observer is gone for good.
      dispatch_sync(queue_, ^{});
    }
  }

  void unload() {
    {
      std::lock_guard lock(mutex_);
      if (alive_) {
        alive_->store(false);
      }
      call_ = nullptr;
    }
    [observer_ stop];
    observer_ = nil;
    if (end_ != nil) {
      [NSNotificationCenter.defaultCenter removeObserver:end_];
      end_ = nil;
    }
    item_ = nil;
  }

  int id_;
  std::mutex mutex_;
  std::shared_ptr<std::atomic<bool>> alive_;
  std::function<void(Change)> call_;
  dispatch_queue_t queue_;
  AVPlayer *player_;
  AVPlayerItem *item_;
  NGNVideoObserver *observer_;
  id end_;
  id time_;
  bool pitch_{true};
};

class AVVideoOutput final : public VideoOutput {
 public:
  std::unique_ptr<VideoPlayback> make(int id) override {
    return std::make_unique<AVPlayback>(id);
  }
};

} // namespace

std::shared_ptr<VideoOutput> makeVideoOutput() {
  return std::make_shared<AVVideoOutput>();
}

} // namespace ngn::appkit

@implementation NGNVideoSurface {
  std::function<void(const std::string &)> _events;
  AVPlayerView *_playerView;
  BOOL _fullScreen;
  BOOL _detached;
  BOOL _observing;
}

- (instancetype)initWithFrame:(NSRect)frame events:(std::function<void(const std::string &)>)events {
  if ((self = [super initWithFrame:frame])) {
    _events = std::move(events);
    _playerView = [[AVPlayerView alloc] initWithFrame:self.bounds];
    _playerView.delegate = self;
    _playerView.pictureInPictureDelegate = self;
    _playerView.updatesNowPlayingInfoCenter = NO;
    [_playerView addObserver:self forKeyPath:@"readyForDisplay" options:NSKeyValueObservingOptionNew context:nil];
    _observing = YES;
    [self addSubview:_playerView];
  }
  return self;
}

- (void)dealloc {
  if (_observing) {
    [_playerView removeObserver:self forKeyPath:@"readyForDisplay"];
  }
  _playerView.delegate = nil;
  _playerView.pictureInPictureDelegate = nil;
}

- (AVPlayerView *)playerView {
  return _playerView;
}

- (BOOL)fullScreen {
  return _fullScreen;
}

- (void)send:(const char *)name {
  if (!_detached && _events) {
    _events(name);
  }
}

- (void)apply:(const ngn::VideoViewModel &)model {
  AVPlayer *player = model.player ? NGNVideoPlayerFor(*model.player) : nil;
  if (_playerView.player != player) {
    _playerView.player = player;
  }
  _playerView.controlsStyle = model.nativeControls ? AVPlayerViewControlsStyleInline : AVPlayerViewControlsStyleNone;
  switch (model.contentFit) {
    case ngn::VideoViewModel::Fit::Contain: _playerView.videoGravity = AVLayerVideoGravityResizeAspect; break;
    case ngn::VideoViewModel::Fit::Cover: _playerView.videoGravity = AVLayerVideoGravityResizeAspectFill; break;
    case ngn::VideoViewModel::Fit::Fill: _playerView.videoGravity = AVLayerVideoGravityResize; break;
  }
  _playerView.showsFullScreenToggleButton = model.fullscreen;
  _playerView.allowsPictureInPicturePlayback = model.pictureInPicture;
  _playerView.showsTimecodes = model.timecodes;
  _playerView.allowsVideoFrameAnalysis = model.frameAnalysis;
}

- (void)layout {
  [super layout];
  // Away in full screen, the player view is AVKit's to place.
  if (_playerView.superview == self) {
    _playerView.frame = self.bounds;
  }
}

- (void)detach {
  _detached = YES;
  if (!_fullScreen) {
    _playerView.player = nil;
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if ([change[NSKeyValueChangeNewKey] boolValue]) {
    [self send:"firstFrameRender"];
  }
}

- (void)playerViewWillEnterFullScreen:(AVPlayerView *)playerView {
  _fullScreen = YES;
  [self send:"fullscreenEnter"];
}

- (void)playerViewDidExitFullScreen:(AVPlayerView *)playerView {
  _fullScreen = NO;
  [self send:"fullscreenExit"];
  if (_detached) {
    _playerView.player = nil;
    return;
  }
  if (_playerView.superview == self) {
    _playerView.frame = self.bounds;
  }
}

- (void)playerViewWillStartPictureInPicture:(AVPlayerView *)playerView {
  [self send:"pictureInPictureStart"];
}

- (void)playerViewDidStopPictureInPicture:(AVPlayerView *)playerView {
  [self send:"pictureInPictureStop"];
}

@end
