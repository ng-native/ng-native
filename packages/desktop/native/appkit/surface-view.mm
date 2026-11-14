#import "surface-view.h"

namespace {
std::function<void(facebook::react::Tag, std::optional<ngn::ContainerInsets>)> gInsetsChanged;
} // namespace

@implementation NGNSurfaceView {
  ngn::InputSink *_input;
  ngn::ContainerId _container;
  facebook::react::Tag _rootTag;
  std::optional<ngn::ContainerInsets> _reported;
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
  }
  return self;
}

- (void)dealloc {
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
  input.pressure = event.type == NSEventTypeMouseMoved ? 0 : event.pressure;
  input.timestamp = event.timestamp;
  return input;
}

- (void)mouseDown:(NSEvent *)event {
  [self.window makeFirstResponder:self];
  _input->pointerDown([self inputFor:event]);
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
  }
}

- (void)mouseEntered:(NSEvent *)event {
  if ([self ownsPointer:event]) {
    _input->pointerMove([self inputFor:event]);
  }
}

- (void)mouseExited:(NSEvent *)event {
  _input->pointerLeave(_surfaceId, [self inputFor:event]);
}

@end
