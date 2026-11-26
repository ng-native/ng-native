// The window controls moved by trafficLightPosition (window-buttons.h), in an offscreen window that
// is never shown.
#include "../window-buttons.h"

#include <doctest/doctest.h>

namespace {

NSWindow *hiddenTitleWindow() {
  [NSApplication sharedApplication];
  NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
      NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 400)
                                                 styleMask:style
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
  return window;
}

// A button's frame in points from the window's top-left, y down.
NSRect fromTopLeft(NSWindow *window, NSButton *button) {
  NSRect inWindow = [button convertRect:button.bounds toView:nil];
  return NSMakeRect(NSMinX(inWindow), NSHeight(window.frame) - NSMaxY(inWindow), NSWidth(inWindow), NSHeight(inWindow));
}

} // namespace

TEST_CASE("trafficLightPosition puts the close button's top-left there, the others beside it at the system's spacing") {
  NSWindow *window = hiddenTitleWindow();
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *minimise = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  CGFloat spacing = NSMinX(minimise.frame) - NSMinX(close.frame);
  REQUIRE(spacing > 0);
  NSRect before = fromTopLeft(window, close);
  CHECK(NSMinY(before) != doctest::Approx(28));

  ngn::appkit::placeWindowButtons(window, {.x = 18, .y = 28});
  NSRect placed = fromTopLeft(window, close);
  CHECK(NSMinX(placed) == doctest::Approx(18));
  CHECK(NSMinY(placed) == doctest::Approx(28));
  CHECK(NSMinX(fromTopLeft(window, minimise)) == doctest::Approx(18 + spacing));
  CHECK(NSMinX(fromTopLeft(window, zoom)) == doctest::Approx(18 + 2 * spacing));
  CHECK(NSMinY(fromTopLeft(window, zoom)) == doctest::Approx(28));

  // Placed again after the window grows, the buttons keep to the top-left.
  [window setContentSize:NSMakeSize(800, 600)];
  ngn::appkit::placeWindowButtons(window, {.x = 18, .y = 28});
  CHECK(NSMinX(fromTopLeft(window, close)) == doctest::Approx(18));
  CHECK(NSMinY(fromTopLeft(window, close)) == doctest::Approx(28));
  [window close];
}
