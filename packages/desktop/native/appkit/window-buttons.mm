#import "window-buttons.h"

namespace ngn::appkit {

void placeWindowButtons(NSWindow *window, const WindowButtonsPosition &position) {
  if ((window.styleMask & NSWindowStyleMaskFullScreen) != 0) {
    return;
  }
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *minimise = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  // The buttons are in the title bar view, which fills its container.
  NSView *container = close.superview.superview;
  if (close == nil || minimise == nil || zoom == nil || container == nil) {
    return;
  }
  CGFloat buttonHeight = NSHeight(close.frame);
  CGFloat spacing = NSMinX(minimise.frame) - NSMinX(close.frame);
  // Tall enough to hold the buttons `y` down with as much below them, as Electron does: the title
  // bar's views lay out from its bottom.
  CGFloat height = buttonHeight + 2 * position.y;
  NSRect frame = container.frame;
  frame.size.height = height;
  frame.origin.y = NSHeight(container.superview.bounds) - height;
  container.frame = frame;
  [container layoutSubtreeIfNeeded];
  NSArray<NSButton *> *buttons = @[ close, minimise, zoom ];
  for (NSUInteger i = 0; i < buttons.count; i++) {
    [buttons[i] setFrameOrigin:NSMakePoint(position.x + spacing * i, (height - buttonHeight) / 2)];
  }
}

} // namespace ngn::appkit
