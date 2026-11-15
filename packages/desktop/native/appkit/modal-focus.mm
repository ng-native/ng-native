#import "modal-focus.h"

namespace ngn::appkit {

NSView *focusHolder(NSWindow *window) {
  NSResponder *first = window.firstResponder;
  if ([first isKindOfClass:NSTextView.class] && ((NSTextView *)first).isFieldEditor) {
    id delegate = ((NSTextView *)first).delegate;
    return [delegate isKindOfClass:NSView.class] ? (NSView *)delegate : nil;
  }
  return [first isKindOfClass:NSView.class] ? (NSView *)first : nil;
}

bool returnFocus(NSWindow *window, NSView *holder) {
  if (window == nil || holder == nil || holder.window != window) {
    return false;
  }
  return [window makeFirstResponder:holder];
}

} // namespace ngn::appkit
