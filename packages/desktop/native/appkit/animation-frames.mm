#include "animation-frames.h"

#include "ngn/worklet-host.h"

#import <AppKit/AppKit.h>
#import <CoreVideo/CoreVideo.h>
#import <QuartzCore/QuartzCore.h>

#include <atomic>

// A display link on the screen the app's key window is on (the main screen before one opens),
// paused while no animation wants frames: a still app takes no wakeups from it. CADisplayLink from
// macOS 14, and CVDisplayLink before, its frames moved to the main thread.
@interface NGNAnimationFrameDriver : NSObject
- (void)update;
@end

@implementation NGNAnimationFrameDriver {
  id _link;
  NSScreen *__weak _screen;
  CVDisplayLinkRef _cvLink;
  std::atomic<bool> _cvFramePending;
}

- (void)update {
  NSScreen *screen = NSApp.keyWindow.screen;
  if (screen == nil) {
    screen = NSApp.mainWindow.screen != nil ? NSApp.mainWindow.screen : NSScreen.mainScreen;
  }
  bool wanted = ngn::workletHost().frames.wanted();
  if (@available(macOS 14.0, *)) {
    if (_link == nil || screen != _screen) {
      [(CADisplayLink *)_link invalidate];
      _screen = screen;
      _link = [screen displayLinkWithTarget:self selector:@selector(frame:)];
      [(CADisplayLink *)_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
    ((CADisplayLink *)_link).paused = !wanted;
    return;
  }
  if (_cvLink == nullptr) {
    CVDisplayLinkCreateWithActiveCGDisplays(&_cvLink);
    CVDisplayLinkSetOutputCallback(_cvLink, &cvFrame, (__bridge void *)self);
  }
  if (wanted && !CVDisplayLinkIsRunning(_cvLink)) {
    CVDisplayLinkStart(_cvLink);
  } else if (!wanted && CVDisplayLinkIsRunning(_cvLink)) {
    CVDisplayLinkStop(_cvLink);
  }
}

- (void)frame:(CADisplayLink *)link API_AVAILABLE(macos(14.0)) {
  // The time the frame will be shown, as iOS's worklets and Reanimated take it, in milliseconds.
  ngn::workletHost().frames.frame(link.targetTimestamp * 1000);
}

static CVReturn cvFrame(CVDisplayLinkRef, const CVTimeStamp *, const CVTimeStamp *output, CVOptionFlags, CVOptionFlags *, void *context) {
  NGNAnimationFrameDriver *driver = (__bridge NGNAnimationFrameDriver *)context;
  // One frame waits on the main thread at most: a busy main thread skips frames, as a display link does.
  if (driver->_cvFramePending.exchange(true)) {
    return kCVReturnSuccess;
  }
  double ms = static_cast<double>(output->hostTime) / CVGetHostClockFrequency() * 1000;
  dispatch_async(dispatch_get_main_queue(), ^{
    driver->_cvFramePending = false;
    ngn::workletHost().frames.frame(ms);
    [driver update];
  });
  return kCVReturnSuccess;
}

@end

namespace ngn::appkit {

void installWorkletHost(std::shared_ptr<MountingManager> mounting) {
  static NGNAnimationFrameDriver *driver = [NGNAnimationFrameDriver new];
  auto &host = workletHost();
  host.runOnUiThread = [](std::function<void()> task) {
    auto shared = std::make_shared<std::function<void()>>(std::move(task));
    dispatch_async(dispatch_get_main_queue(), ^{
      (*shared)();
    });
  };
  host.isUiThread = [] { return NSThread.isMainThread == YES; };
  host.now = [] { return CACurrentMediaTime() * 1000; };
  host.frames.onWanted = [](bool) {
    // Read again on the main thread: a start and a stop from two threads may arrive in either order.
    dispatch_async(dispatch_get_main_queue(), ^{
      [driver update];
    });
  };
  std::weak_ptr<MountingManager> weak = mounting;
  host.synchronouslyUpdateView = [weak](Tag tag, const folly::dynamic &props) {
    if (auto mounting = weak.lock()) {
      mounting->synchronouslyUpdateViewOnUIThread(tag, props);
    }
  };
  host.readMountedProps = [weak](Tag tag) -> facebook::react::Props::Shared {
    auto mounting = weak.lock();
    const auto *node = mounting ? mounting->tree().find(tag) : nullptr;
    return node ? node->view.props : nullptr;
  };
}

} // namespace ngn::appkit
