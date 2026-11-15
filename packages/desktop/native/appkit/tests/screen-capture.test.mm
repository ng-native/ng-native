// WindowShield (screen-capture.mm) on windows made offscreen and never shown.
#include "../screen-capture.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>

#include <atomic>
#include <memory>

namespace {

NSWindow *offscreenWindow() {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(-10000, -10000, 100, 100)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:YES];
  window.releasedWhenClosed = NO;
  return window;
}

} // namespace

TEST_CASE("WindowShield keeps the app's windows out of capture while it protects them") {
  NSWindow *before = offscreenWindow();
  auto shield = ngn::appkit::captureShield();
  auto module = ngn::makeScreenCaptureModule(shield);
  auto prevent = [&](const char *method) {
    module->callWithPromise(method, folly::dynamic::array("card"), {.resolve = [](folly::dynamic) {}, .reject = {}});
  };
  prevent("preventScreenCaptureAsync");
  CHECK(before.sharingType == NSWindowSharingNone);

  // A window the host makes after, before it is shown, and one AppKit updates.
  NSWindow *made = offscreenWindow();
  ngn::appkit::shieldNewWindow(made);
  CHECK(made.sharingType == NSWindowSharingNone);
  NSWindow *updated = offscreenWindow();
  updated.sharingType = NSWindowSharingReadOnly;
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidUpdateNotification object:updated];
  CHECK(updated.sharingType == NSWindowSharingNone);

  prevent("allowScreenCaptureAsync");
  for (NSWindow *window in @[ before, made, updated ]) {
    CHECK(window.sharingType == NSWindowSharingReadOnly);
  }
  // Allowed, a new window is left as AppKit makes it.
  NSWindow *after = offscreenWindow();
  ngn::appkit::shieldNewWindow(after);
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidUpdateNotification object:after];
  CHECK(after.sharingType == NSWindowSharingReadOnly);
}

TEST_CASE("WindowShield, asked off the main thread, answers once the windows have the state") {
  NSWindow *window = offscreenWindow();
  auto shield = ngn::appkit::captureShield();
  struct Seen {
    std::atomic<bool> answered{false};
    std::atomic<NSWindowSharingType> sharing{NSWindowSharingReadOnly};
  };
  auto seen = std::make_shared<Seen>();
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    shield->setProtected(true, [window, seen] {
      seen->sharing = window.sharingType;
      seen->answered = true;
    });
  });
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!seen->answered && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  CHECK(seen->answered);
  CHECK(seen->sharing == NSWindowSharingNone);
  shield->setProtected(false, nullptr);
  CHECK(window.sharingType == NSWindowSharingReadOnly);
}

TEST_CASE("WindowShield applies each request's own state before answering it, the last one staying") {
  NSWindow *window = offscreenWindow();
  auto shield = ngn::appkit::captureShield();
  struct Seen {
    std::atomic<int> answered{0};
    std::atomic<NSWindowSharingType> atProtect{NSWindowSharingReadOnly};
    std::atomic<NSWindowSharingType> atAllow{NSWindowSharingNone};
  };
  auto seen = std::make_shared<Seen>();
  // Both asked before the main thread applies either: setProtected only queues off the main thread,
  // so the main thread can wait for both without running its queue.
  dispatch_semaphore_t asked = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    shield->setProtected(true, [window, seen] {
      seen->atProtect = window.sharingType;
      seen->answered++;
    });
    shield->setProtected(false, [window, seen] {
      seen->atAllow = window.sharingType;
      seen->answered++;
    });
    dispatch_semaphore_signal(asked);
  });
  REQUIRE(dispatch_semaphore_wait(asked, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:5];
  while (seen->answered < 2 && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  REQUIRE(seen->answered == 2);
  CHECK(seen->atProtect == NSWindowSharingNone);
  CHECK(seen->atAllow == NSWindowSharingReadOnly);
  CHECK(window.sharingType == NSWindowSharingReadOnly);
}

// One request asked off the main thread and queued, then the other asked on the main thread
// before the queued one applies: the windows keep the main thread's, the one asked last.
void askQueuedThenMain(bool queued) {
  NSWindow *window = offscreenWindow();
  auto shield = ngn::appkit::captureShield();
  auto answered = std::make_shared<std::atomic<bool>>(false);
  dispatch_semaphore_t asked = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    shield->setProtected(queued, [answered] { *answered = true; });
    dispatch_semaphore_signal(asked);
  });
  // The main queue does not run while this waits, so the queued request is still pending.
  REQUIRE(dispatch_semaphore_wait(asked, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  shield->setProtected(!queued, nullptr);
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!*answered && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, false);
  }
  REQUIRE(*answered);
  NSWindowSharingType wanted = queued ? NSWindowSharingReadOnly : NSWindowSharingNone;
  CHECK(window.sharingType == wanted);
  // A new window follows the same state.
  NSWindow *after = offscreenWindow();
  ngn::appkit::shieldNewWindow(after);
  CHECK(after.sharingType == wanted);
  shield->setProtected(false, nullptr);
}

TEST_CASE("WindowShield keeps a main-thread allow over a protect still queued") {
  askQueuedThenMain(true);
}

TEST_CASE("WindowShield keeps a main-thread protect over an allow still queued") {
  askQueuedThenMain(false);
}
