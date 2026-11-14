// The focus a sheet, cover or popover gives back when it closes (modal-focus.h), on an offscreen
// window that is never shown.
#include "../modal-focus.h"

#include <doctest/doctest.h>

namespace {

NSWindow *offscreenWindow() {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 320, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:YES];
  window.releasedWhenClosed = NO;
  return window;
}

NSTextField *field(NSWindow *window, CGFloat y) {
  NSTextField *f = [NSTextField textFieldWithString:@""];
  f.frame = NSMakeRect(10, y, 200, 24);
  [window.contentView addSubview:f];
  return f;
}

} // namespace

TEST_CASE("the focus holder is a text field, not its field editor, and nothing when the window has the focus") {
  NSWindow *window = offscreenWindow();
  NSTextField *name = field(window, 10);
  [window makeFirstResponder:nil];
  CHECK((ngn::appkit::focusHolder(window) == nil));
  REQUIRE([window makeFirstResponder:name]);
  // The field editor is the first responder; the field is what holds the focus.
  CHECK((window.firstResponder != name));
  CHECK((ngn::appkit::focusHolder(window) == name));
  NSButton *button = [NSButton buttonWithTitle:@"Go" target:nil action:nil];
  [window.contentView addSubview:button];
  if ([window makeFirstResponder:button]) {
    CHECK((ngn::appkit::focusHolder(window) == button));
  }
  [window close];
}

TEST_CASE("the focus goes back to its holder while the holder is still in the window") {
  NSWindow *window = offscreenWindow();
  NSTextField *name = field(window, 10);
  NSTextField *email = field(window, 50);
  REQUIRE([window makeFirstResponder:name]);
  NSView *holder = ngn::appkit::focusHolder(window);
  // A presentation takes the focus, then closes.
  REQUIRE([window makeFirstResponder:email]);
  CHECK(ngn::appkit::returnFocus(window, holder));
  CHECK((ngn::appkit::focusHolder(window) == name));

  // A holder that has left the window, or another window's, is not given the focus.
  REQUIRE([window makeFirstResponder:email]);
  [name removeFromSuperview];
  CHECK_FALSE(ngn::appkit::returnFocus(window, name));
  CHECK((ngn::appkit::focusHolder(window) == email));
  NSWindow *other = offscreenWindow();
  CHECK_FALSE(ngn::appkit::returnFocus(other, email));
  CHECK_FALSE(ngn::appkit::returnFocus(window, nil));
  [other close];
  [window close];
}
