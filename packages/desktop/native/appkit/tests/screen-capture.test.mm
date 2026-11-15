// WindowShield (screen-capture.mm) on windows made offscreen and never shown.
#include "../screen-capture.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>

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
