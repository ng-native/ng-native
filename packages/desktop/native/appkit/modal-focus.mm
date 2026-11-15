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
  // A view that refuses the focus leaves the window holding it, and makeFirstResponder: still
  // answers YES: only the holder having it again counts.
  if (!holder.acceptsFirstResponder) {
    return false;
  }
  return [window makeFirstResponder:holder] && focusHolder(window) == holder;
}

} // namespace ngn::appkit
