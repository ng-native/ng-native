#import "surface-view.h"

#import "host-view.h"

using facebook::react::Cursor;

namespace {
std::function<void(facebook::react::Tag, std::optional<ngn::ContainerInsets>)> gInsetsChanged;
NSCursor *gCursor = nil;

// A cursor of nothing, for `cursor: none`.
NSCursor *noCursor() {
  static NSCursor *none = [[NSCursor alloc] initWithImage:[[NSImage alloc] initWithSize:NSMakeSize(1, 1)]
                                                  hotSpot:NSZeroPoint];
  return none;
}

// CSS's cursors, as AppKit draws them. One AppKit has no picture for is the arrow.
NSCursor *nsCursor(Cursor cursor) {
  switch (cursor) {
    case Cursor::Pointer:
      return NSCursor.pointingHandCursor;
    case Cursor::Text:
      return NSCursor.IBeamCursor;
    case Cursor::NotAllowed:
    case Cursor::NoDrop:
      return NSCursor.operationNotAllowedCursor;
    case Cursor::Grab:
      return NSCursor.openHandCursor;
    case Cursor::Grabbing:
      return NSCursor.closedHandCursor;
    case Cursor::Crosshair:
    case Cursor::Cell:
      return NSCursor.crosshairCursor;
    case Cursor::Copy:
      return NSCursor.dragCopyCursor;
    case Cursor::Alias:
      return NSCursor.dragLinkCursor;
    case Cursor::ContextMenu:
      return NSCursor.contextualMenuCursor;
    case Cursor::ColResize:
    case Cursor::EWResize:
    case Cursor::EResize:
    case Cursor::WResize:
      return NSCursor.resizeLeftRightCursor;
    case Cursor::RowResize:
    case Cursor::NSResize:
    case Cursor::NResize:
    case Cursor::SResize:
      return NSCursor.resizeUpDownCursor;
    case Cursor::NWSEResize:
    case Cursor::NWResize:
    case Cursor::SEResize:
      if (@available(macOS 15.0, *)) {
        return [NSCursor frameResizeCursorFromPosition:NSCursorFrameResizePositionTopLeft
                                          inDirections:NSCursorFrameResizeDirectionsAll];
      }
      return NSCursor.arrowCursor;
    case Cursor::NESWResize:
    case Cursor::NEResize:
    case Cursor::SWResize:
      if (@available(macOS 15.0, *)) {
        return [NSCursor frameResizeCursorFromPosition:NSCursorFrameResizePositionTopRight
                                          inDirections:NSCursorFrameResizeDirectionsAll];
      }
      return NSCursor.arrowCursor;
    case Cursor::ZoomIn:
      if (@available(macOS 15.0, *)) {
        return NSCursor.zoomInCursor;
      }
      return NSCursor.arrowCursor;
    case Cursor::ZoomOut:
      if (@available(macOS 15.0, *)) {
        return NSCursor.zoomOutCursor;
      }
      return NSCursor.arrowCursor;
    case Cursor::None:
      return noCursor();
    default:
      return NSCursor.arrowCursor;
  }
}

} // namespace

@implementation NGNSurfaceView {
  ngn::InputSink *_input;
  ngn::ContainerId _container;
  facebook::react::Tag _rootTag;
  std::optional<ngn::ContainerInsets> _reported;
  id _wheelMonitor;
}

+ (void)showCursor:(Cursor)cursor {
  gCursor = nsCursor(cursor);
  [gCursor set];
}

+ (std::function<void(facebook::react::Tag, std::optional<ngn::ContainerInsets>)>)insetsChanged {
  return gInsetsChanged;
}
+ (void)setInsetsChanged:(std::function<void(facebook::react::Tag, std::optional<ngn::ContainerInsets>)>)fn {
  gInsetsChanged = std::move(fn);
}

- (instancetype)initWithFrame:(NSRect)frame surfaceId:(facebook::react::SurfaceId)surfaceId input:(ngn::InputSink *)input {
  // The surface's main container hit-tests from the surface's root view.
  return [self initWithFrame:frame surfaceId:surfaceId container:surfaceId rootTag:surfaceId input:input];
}

- (instancetype)initWithFrame:(NSRect)frame
                    surfaceId:(facebook::react::SurfaceId)surfaceId
                    container:(ngn::ContainerId)container
                      rootTag:(facebook::react::Tag)rootTag
                        input:(ngn::InputSink *)input {
  if ((self = [super initWithFrame:frame])) {
    _surfaceId = surfaceId;
    _container = container;
    _rootTag = rootTag;
    _input = input;
    _input->addContainer(container, surfaceId, rootTag);
    // The wheel reaches the core before the scroll view under the pointer takes it, and still
    // scrolls it: a `(wheel)` listener hears the turn without stopping the scroll, as on the web.
    __weak NGNSurfaceView *weakSelf = self;
    _wheelMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                                          handler:^NSEvent *(NSEvent *event) {
                                                            [weakSelf wheelEvent:event];
                                                            return event;
                                                          }];
  }
  return self;
}

- (void)dealloc {
  [NSEvent removeMonitor:_wheelMonitor];
  _input->removeContainer(_container);
  if (gInsetsChanged && _reported) {
    gInsetsChanged(_rootTag, std::nullopt);
  }
}

// What of the container the window's title bar and toolbar cover (the content runs under them),
// and how far the window controls reach in from the leading edge.
- (void)reportInsets {
  if (!gInsetsChanged || self.window == nil) {
    return;
  }
  NSEdgeInsets safe = self.safeAreaInsets;
  double leading = 0;
  if (NSButton *zoom = [self.window standardWindowButton:NSWindowZoomButton]; zoom != nil && safe.top > 0) {
    NSRect controls = [self convertRect:zoom.bounds fromView:zoom];
    leading = std::max<double>(0, NSMaxX(controls));
  }
  ngn::ContainerInsets insets{
      .size = {static_cast<facebook::react::Float>(self.bounds.size.width),
               static_cast<facebook::react::Float>(self.bounds.size.height)},
      .insets = {.left = static_cast<facebook::react::Float>(safe.left),
                 .top = static_cast<facebook::react::Float>(safe.top),
                 .right = static_cast<facebook::react::Float>(safe.right),
                 .bottom = static_cast<facebook::react::Float>(safe.bottom)},
      .titlebarLeading = leading,
  };
  if (_reported != insets) {
    _reported = insets;
    gInsetsChanged(_rootTag, insets);
  }
}

- (void)layout {
  [super layout];
  [self reportInsets];
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self reportInsets];
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  for (NSTrackingArea *area in self.trackingAreas) {
    [self removeTrackingArea:area];
  }
  [self addTrackingArea:[[NSTrackingArea alloc]
                            initWithRect:NSZeroRect
                                 options:NSTrackingMouseMoved | NSTrackingMouseEnteredAndExited |
                                         NSTrackingActiveAlways | NSTrackingInVisibleRect
                                   owner:self
                                userInfo:nil]];
}

- (ngn::PointerInput)inputFor:(NSEvent *)event {
  NSPoint inView = [self convertPoint:event.locationInWindow fromView:nil];
  NSPoint onScreen = [self.window convertPointToScreen:event.locationInWindow];
  // AppKit's screen coordinates start at the bottom left of the primary display.
  CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame);
  ngn::PointerInput input;
  input.container = _container;
  input.point = {static_cast<float>(inView.x), static_cast<float>(inView.y)};
  input.screenPoint = {static_cast<float>(onScreen.x), static_cast<float>(top - onScreen.y)};
  input.buttons = static_cast<int>(NSEvent.pressedMouseButtons);
  // Only a button's events have a pressure: asking a wheel's or a move's throws.
  switch (event.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeLeftMouseUp:
    case NSEventTypeLeftMouseDragged:
    case NSEventTypeRightMouseDown:
    case NSEventTypeRightMouseUp:
    case NSEventTypeOtherMouseDown:
    case NSEventTypeOtherMouseUp:
      input.pressure = event.pressure;
      break;
    default:
      input.pressure = 0;
  }
  input.timestamp = event.timestamp;
  if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeLeftMouseUp) {
    input.clickCount = static_cast<int>(event.clickCount);
  }
  return input;
}

- (void)mouseDown:(NSEvent *)event {
  // Control-click is the Mac's secondary click.
  if ((event.modifierFlags & NSEventModifierFlagControl) != 0 && _input->contextMenu([self inputFor:event])) {
    return;
  }
  // A click focuses the focusable view it lands in, as on the web, without a focus ring.
  NSView *hit = [self hitTest:[self.superview convertPoint:event.locationInWindow fromView:nil]];
  NSResponder *focus = self;
  for (NSView *v = hit; v != nil && v != self; v = v.superview) {
    if ([v isKindOfClass:NGNView.class] && v.acceptsFirstResponder) {
      focus = v;
      break;
    }
  }
  if (self.window.firstResponder != focus) {
    [self.window makeFirstResponder:focus];
  }
  _input->pointerDown([self inputFor:event]);
}

- (void)rightMouseDown:(NSEvent *)event {
  if (!_input->contextMenu([self inputFor:event])) {
    [super rightMouseDown:event];
  }
}

- (void)wheelEvent:(NSEvent *)event {
  if (event.window != self.window || ![self ownsPointer:event]) {
    return;
  }
  // The DOM's deltas are how far the content would move, down and right positive: AppKit's are
  // the other way round. A wheel without precise deltas counts lines.
  ngn::WheelDelta delta{
      .x = -event.scrollingDeltaX,
      .y = -event.scrollingDeltaY,
      .z = 0,
      .mode = event.hasPreciseScrollingDeltas ? 0 : 1,
  };
  if (delta.x != 0 || delta.y != 0) {
    _input->wheel([self inputFor:event], delta);
  }
}

- (void)mouseDragged:(NSEvent *)event {
  _input->pointerMove([self inputFor:event]);
}

- (void)mouseUp:(NSEvent *)event {
  _input->pointerUp([self inputFor:event]);
}

// Whether this container is the innermost one under the pointer. A container presented over
// this one (a modal's cover) reports its own moves, so this one stays out of them: hover never
// lands on what is under a cover.
- (BOOL)ownsPointer:(NSEvent *)event {
  // A window over this one (a popover's) takes the pointer where it covers this window.
  NSPoint onScreen = [self.window convertPointToScreen:event.locationInWindow];
  if ([NSWindow windowNumberAtPoint:onScreen belowWindowWithWindowNumber:0] != self.window.windowNumber) {
    return NO;
  }
  NSView *content = self.window.contentView;
  NSView *hit = [content hitTest:[content.superview convertPoint:event.locationInWindow fromView:nil]];
  for (NSView *v = hit; v != nil; v = v.superview) {
    if ([v isKindOfClass:NGNSurfaceView.class]) {
      return v == self;
    }
  }
  return NO;
}

- (void)mouseMoved:(NSEvent *)event {
  if ([self ownsPointer:event]) {
    _input->pointerMove([self inputFor:event]);
    // A text field's cursor rect sets the I-beam behind the core's back as the pointer crosses it.
    [gCursor set];
  }
}

- (void)mouseEntered:(NSEvent *)event {
  if ([self ownsPointer:event]) {
    _input->pointerMove([self inputFor:event]);
    [gCursor set];
  }
}

- (void)mouseExited:(NSEvent *)event {
  _input->pointerLeave(_surfaceId, [self inputFor:event]);
}

@end
