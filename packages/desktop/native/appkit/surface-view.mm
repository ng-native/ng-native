#import "surface-view.h"

@implementation NGNSurfaceView {
  ngn::InputSink *_input;
}

- (instancetype)initWithFrame:(NSRect)frame surfaceId:(facebook::react::SurfaceId)surfaceId input:(ngn::InputSink *)input {
  if ((self = [super initWithFrame:frame])) {
    _surfaceId = surfaceId;
    _input = input;
    // The surface's main container hit-tests from the surface's root view.
    _input->addContainer(surfaceId, surfaceId, surfaceId);
  }
  return self;
}

- (void)dealloc {
  _input->removeContainer(_surfaceId);
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
  input.container = _surfaceId;
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

- (void)mouseMoved:(NSEvent *)event {
  _input->pointerMove([self inputFor:event]);
}

- (void)mouseEntered:(NSEvent *)event {
  _input->pointerMove([self inputFor:event]);
}

- (void)mouseExited:(NSEvent *)event {
  _input->pointerLeave(_surfaceId, [self inputFor:event]);
}

@end
