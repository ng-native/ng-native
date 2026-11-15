// The AVPlayer half of NgNativeVideo (video.mm) in the test binary, on a short H.264 clip written
// here with AVAssetWriter: the player's states, time updates, the end, a frame read back through
// AVPlayerItemVideoOutput, and NGNVideoSurface's props and full screen, in no window.
#include "../video.h"

#include <doctest/doctest.h>

#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>

#include <atomic>
#include <string>
#include <unistd.h>
#include <vector>

namespace {

// A clip `seconds` long at 10 frames a second, every frame one colour.
std::string writeClip(double seconds, CGFloat red, CGFloat green, CGFloat blue) {
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"ngn-video-%d.mov", getpid()]];
  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  NSError *error = nil;
  AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:[NSURL fileURLWithPath:path] fileType:AVFileTypeQuickTimeMovie error:&error];
  REQUIRE((writer != nil));
  const int width = 64;
  const int height = 48;
  AVAssetWriterInput *input = [AVAssetWriterInput
      assetWriterInputWithMediaType:AVMediaTypeVideo
                     outputSettings:@{AVVideoCodecKey : AVVideoCodecTypeH264, AVVideoWidthKey : @(width), AVVideoHeightKey : @(height)}];
  auto *adaptor = [AVAssetWriterInputPixelBufferAdaptor
      assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input
                                 sourcePixelBufferAttributes:@{
                                   (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
                                   (id)kCVPixelBufferWidthKey : @(width),
                                   (id)kCVPixelBufferHeightKey : @(height),
                                 }];
  [writer addInput:input];
  REQUIRE([writer startWriting]);
  [writer startSessionAtSourceTime:kCMTimeZero];
  int frames = static_cast<int>(seconds * 10);
  for (int frame = 0; frame < frames; frame++) {
    while (!input.readyForMoreMediaData) {
      usleep(1000);
    }
    CVPixelBufferRef buffer = nullptr;
    REQUIRE(CVPixelBufferPoolCreatePixelBuffer(nullptr, adaptor.pixelBufferPool, &buffer) == kCVReturnSuccess);
    CVPixelBufferLockBaseAddress(buffer, 0);
    auto *bytes = static_cast<uint8_t *>(CVPixelBufferGetBaseAddress(buffer));
    size_t row = CVPixelBufferGetBytesPerRow(buffer);
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        uint8_t *pixel = bytes + y * row + x * 4;
        pixel[0] = static_cast<uint8_t>(blue * 255);
        pixel[1] = static_cast<uint8_t>(green * 255);
        pixel[2] = static_cast<uint8_t>(red * 255);
        pixel[3] = 255;
      }
    }
    CVPixelBufferUnlockBaseAddress(buffer, 0);
    REQUIRE([adaptor appendPixelBuffer:buffer withPresentationTime:CMTimeMake(frame, 10)]);
    CVPixelBufferRelease(buffer);
  }
  [input markAsFinished];
  [writer endSessionAtSourceTime:CMTimeMake(frames, 10)];
  dispatch_semaphore_t finished = dispatch_semaphore_create(0);
  [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(finished); }];
  dispatch_semaphore_wait(finished, DISPATCH_TIME_FOREVER);
  REQUIRE(writer.status == AVAssetWriterStatusCompleted);
  return std::string("file://") + path.UTF8String;
}

// Runs the main run loop until `done` or `limit` seconds pass, as the host's main thread would.
template <typename Done>
bool runUntil(Done done, double limit) {
  auto until = [NSDate dateWithTimeIntervalSinceNow:limit];
  while (!done() && [until timeIntervalSinceNow] > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  return done();
}

struct Changes {
  std::atomic<int> states{0};
  std::atomic<int> times{0};
  std::atomic<int> ends{0};
  std::function<void(ngn::VideoPlayback::Change)> counter() {
    return [this](ngn::VideoPlayback::Change change) {
      switch (change) {
        case ngn::VideoPlayback::Change::State: states++; break;
        case ngn::VideoPlayback::Change::Time: times++; break;
        case ngn::VideoPlayback::Change::Ended: ends++; break;
      }
    };
  }
};

// The colour at the middle of `pixels`, drawn into an RGBA bitmap.
std::vector<int> middleColour(CVPixelBufferRef pixels) {
  CIImage *image = [CIImage imageWithCVPixelBuffer:pixels];
  CIContext *context = [CIContext contextWithOptions:nil];
  uint8_t rgba[4] = {};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGRect extent = image.extent;
  [context render:image
         toBitmap:rgba
         rowBytes:4
           bounds:CGRectMake(CGRectGetMidX(extent), CGRectGetMidY(extent), 1, 1)
           format:kCIFormatRGBA8
       colorSpace:space];
  CGColorSpaceRelease(space);
  return {rgba[0], rgba[1], rgba[2]};
}

} // namespace

TEST_CASE("AVPlayback loads a clip, plays it with time updates to its end, and seeks back") {
  auto uri = writeClip(1.0, 1, 0, 0);
  auto output = ngn::appkit::makeVideoOutput();
  auto playback = output->make(41);
  Changes changes;
  playback->load(uri, changes.counter());
  playback->setMuted(true);
  REQUIRE(runUntil([&] { return playback->state().load == ngn::VideoState::Load::Ready; }, 5));
  CHECK(changes.states > 0);
  CHECK(playback->state().duration == doctest::Approx(1.0).epsilon(0.05));
  CHECK_FALSE(playback->state().playing);

  playback->setTimeUpdates(0.1);
  playback->play(2);
  REQUIRE(runUntil([&] { return playback->state().playing; }, 3));
  CHECK(NGNVideoPlayerFor(41).defaultRate == 2);
  REQUIRE(runUntil([&] { return changes.ends.load() == 1; }, 3));
  CHECK(changes.times > 0);
  CHECK(runUntil([&] { return !playback->state().playing; }, 1));
  CHECK(playback->state().currentTime == doctest::Approx(1.0).epsilon(0.05));

  // A rate set while paused waits for play, rather than starting it.
  playback->setRate(1.5);
  CHECK(NGNVideoPlayerFor(41).rate == 0);
  CHECK(NGNVideoPlayerFor(41).defaultRate == 1.5f);

  std::atomic<bool> sought{false};
  playback->seek(0.5, [&] { sought = true; });
  REQUIRE(runUntil([&] { return sought.load(); }, 3));
  CHECK(playback->state().currentTime == doctest::Approx(0.5).epsilon(0.02));
}

TEST_CASE("AVPlayback's player draws the clip's frames, read through AVPlayerItemVideoOutput") {
  auto uri = writeClip(1.0, 0, 0, 1);
  auto playback = ngn::appkit::makeVideoOutput()->make(42);
  Changes changes;
  playback->load(uri, changes.counter());
  AVPlayer *player = NGNVideoPlayerFor(42);
  REQUIRE((player != nil));
  auto *frames = [[AVPlayerItemVideoOutput alloc]
      initWithPixelBufferAttributes:@{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)}];
  [player.currentItem addOutput:frames];
  REQUIRE(runUntil([&] { return playback->state().load == ngn::VideoState::Load::Ready; }, 5));
  playback->setMuted(true);
  playback->play(1);
  CVPixelBufferRef pixels = nullptr;
  runUntil(
      [&] {
        CMTime now = [frames itemTimeForHostTime:CACurrentMediaTime()];
        if ([frames hasNewPixelBufferForItemTime:now]) {
          pixels = [frames copyPixelBufferForItemTime:now itemTimeForDisplay:nil];
        }
        return pixels != nullptr;
      },
      3);
  REQUIRE(pixels != nullptr);
  CHECK(CVPixelBufferGetWidth(pixels) == 64);
  CHECK(CVPixelBufferGetHeight(pixels) == 48);
  auto colour = middleColour(pixels);
  CVPixelBufferRelease(pixels);
  CHECK(colour[0] < 40);
  CHECK(colour[1] < 40);
  CHECK(colour[2] > 200);
}

TEST_CASE("AVPlayback reports a source that cannot open as failed, empties on a null source, and is gone once released") {
  auto playback = ngn::appkit::makeVideoOutput()->make(43);
  Changes changes;
  playback->load(std::string("file:///nowhere/ngn-missing.mov"), changes.counter());
  REQUIRE(runUntil([&] { return playback->state().load == ngn::VideoState::Load::Failed; }, 5));
  CHECK_FALSE(playback->state().error.empty());

  playback->load(std::nullopt, changes.counter());
  CHECK((NGNVideoPlayerFor(43).currentItem == nil));
  CHECK((NGNVideoPlayerFor(43) != nil));
  playback.reset();
  CHECK((NGNVideoPlayerFor(43) == nil));
}

TEST_CASE("NGNVideoSurface shows the player its prop names, with expo-video's iOS view props") {
  auto playback = ngn::appkit::makeVideoOutput()->make(44);
  std::vector<std::string> events;
  NGNVideoSurface *surface = [[NGNVideoSurface alloc] initWithFrame:NSMakeRect(0, 0, 320, 180)
                                                             events:[&](const std::string &name) { events.push_back(name); }];
  [surface layoutSubtreeIfNeeded];
  CHECK(NSEqualRects(surface.playerView.frame, surface.bounds));

  ngn::VideoViewModel model;
  model.player = 44;
  [surface apply:model];
  CHECK((surface.playerView.player == NGNVideoPlayerFor(44)));
  CHECK(surface.playerView.controlsStyle == AVPlayerViewControlsStyleInline);
  CHECK([surface.playerView.videoGravity isEqualToString:AVLayerVideoGravityResizeAspect]);
  CHECK(surface.playerView.showsFullScreenToggleButton);
  CHECK_FALSE(surface.playerView.allowsPictureInPicturePlayback);
  CHECK(surface.playerView.showsTimecodes);

  model.nativeControls = false;
  model.contentFit = ngn::VideoViewModel::Fit::Cover;
  model.fullscreen = false;
  model.pictureInPicture = true;
  model.timecodes = false;
  [surface apply:model];
  CHECK(surface.playerView.controlsStyle == AVPlayerViewControlsStyleNone);
  CHECK([surface.playerView.videoGravity isEqualToString:AVLayerVideoGravityResizeAspectFill]);
  CHECK_FALSE(surface.playerView.showsFullScreenToggleButton);
  CHECK(surface.playerView.allowsPictureInPicturePlayback);
  CHECK_FALSE(surface.playerView.showsTimecodes);

  model.contentFit = ngn::VideoViewModel::Fit::Fill;
  model.player = 999;
  [surface apply:model];
  CHECK([surface.playerView.videoGravity isEqualToString:AVLayerVideoGravityResize]);
  CHECK((surface.playerView.player == nil));

  [surface playerViewWillStartPictureInPicture:surface.playerView];
  [surface playerViewDidStopPictureInPicture:surface.playerView];
  CHECK(events == std::vector<std::string>{"pictureInPictureStart", "pictureInPictureStop"});
}

TEST_CASE("NGNVideoSurface leaves its player view to full screen while it is away, and lets the player go after a detach") {
  auto first = ngn::appkit::makeVideoOutput()->make(45);
  auto second = ngn::appkit::makeVideoOutput()->make(46);
  std::vector<std::string> events;
  NGNVideoSurface *surface = [[NGNVideoSurface alloc] initWithFrame:NSMakeRect(0, 0, 320, 180)
                                                             events:[&](const std::string &name) { events.push_back(name); }];
  ngn::VideoViewModel model;
  model.player = 45;
  [surface apply:model];
  AVPlayerView *playerView = surface.playerView;

  // Full screen takes the player view into a window of its own, as AVKit does.
  [surface playerViewWillEnterFullScreen:playerView];
  CHECK(surface.fullScreen);
  NSView *fullScreen = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 1440, 900)];
  [fullScreen addSubview:playerView];
  playerView.frame = fullScreen.bounds;

  // A commit and a layout while it is away: the player changes, and the view stays where AVKit put it.
  surface.frame = NSMakeRect(0, 0, 200, 100);
  model.player = 46;
  [surface apply:model];
  [surface layout];
  CHECK((playerView.superview == fullScreen));
  CHECK(NSEqualRects(playerView.frame, fullScreen.bounds));
  CHECK((playerView.player == NGNVideoPlayerFor(46)));
  CHECK(surface.subviews.count == 0);

  // Back from full screen: laid out in the surface again.
  [surface addSubview:playerView];
  [surface playerViewDidExitFullScreen:playerView];
  CHECK(NSEqualRects(playerView.frame, surface.bounds));
  CHECK((playerView.player == NGNVideoPlayerFor(46)));
  CHECK(events == std::vector<std::string>{"fullscreenEnter", "fullscreenExit"});

  // Unmounted while full screen: the video keeps showing there until the user exits, with no events.
  [surface playerViewWillEnterFullScreen:playerView];
  [fullScreen addSubview:playerView];
  [surface detach];
  CHECK((playerView.player == NGNVideoPlayerFor(46)));
  [surface addSubview:playerView];
  [surface playerViewDidExitFullScreen:playerView];
  CHECK((playerView.player == nil));
  CHECK(events.size() == 3);

  // Unmounted in place: the player goes at once.
  NGNVideoSurface *other = [[NGNVideoSurface alloc] initWithFrame:NSMakeRect(0, 0, 10, 10) events:nullptr];
  [other apply:model];
  [other detach];
  CHECK((other.playerView.player == nil));
}
