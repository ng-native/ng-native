#import "tab-walk.h"

#import "appkit-backend.h"
#import "host-view.h"
#import "modal-host-view.h"
#import "surface-view.h"

namespace ngn::appkit {

FocusContext focusContext(NSWindow *window) {
  FocusContext context;
  NSResponder *first = window.firstResponder;
  // A field editor stands in for its text field, inside the field's view.
  for (NSView *v = [first isKindOfClass:NSView.class] ? (NSView *)first : nil; v != nil; v = v.superview) {
    if (context.focused == nil && [v isKindOfClass:NGNView.class]) {
      context.focused = (NGNView *)v;
    }
    if ([v isKindOfClass:NGNSurfaceView.class]) {
      context.container = (NGNSurfaceView *)v;
      break;
    }
  }
  if (context.container == nil) {
    context.container =
        [window.contentView isKindOfClass:NGNSurfaceView.class] ? (NGNSurfaceView *)window.contentView : nil;
  }
  NSView *cover = [NGNModalHostView frontCoverIn:window];
  if (cover != nil && ![context.container isDescendantOf:cover]) {
    context.container = (NGNSurfaceView *)cover;
    context.focused = nil;
  }
  return context;
}

bool moveFocus(NSWindow *window, const ViewTree &tree, const AppKitBackend &backend, bool backwards, TabReach reach) {
  auto [container, focused] = focusContext(window);
  if (container == nil) {
    return false;
  }
  bool contained = [NGNModalHostView isPresentationContainer:container];
  std::optional<Tag> from;
  if (focused != nil) {
    from = static_cast<Tag>(focused.reactTag);
  }
  auto count = tabOrder(tree, container.rootTag, reach, from).size();
  // A view that will not take the focus passes Tab on: a disabled control, which
  // makeFirstResponder: would focus all the same, or a field or button AppKit refuses.
  for (size_t tries = 0; tries < count; tries++) {
    auto next = nextInTabOrder(tree, container.rootTag, from, backwards, reach);
    if (!next) {
      return contained;
    }
    NGNView *view = backend.view(*next);
    NSResponder *responder = view.keyboardResponder;
    bool disabled = [responder isKindOfClass:NSControl.class] && !((NSControl *)responder).enabled;
    if (view != nil && !disabled && [window makeFirstResponder:responder]) {
      return true;
    }
    from = next;
  }
  return contained;
}

} // namespace ngn::appkit
