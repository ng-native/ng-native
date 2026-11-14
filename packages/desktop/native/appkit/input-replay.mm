#include "input-replay.h"

#include <memory>

namespace ngn::appkit {

namespace {

// IOKit's gesture phases, which a gesture CGEvent carries (field 132).
int64_t hidPhase(std::optional<GesturePhase> phase) {
  if (!phase) {
    return 0;
  }
  switch (*phase) {
    case GesturePhase::Began:
      return 1;
    case GesturePhase::Changed:
      return 2;
    case GesturePhase::Ended:
      return 4;
    case GesturePhase::Cancelled:
      return 8;
  }
  return 0;
}

// The point in the window's coordinates (bottom-left origin) and on the screens (CGEvent's top-left
// global coordinates).
NSPoint inWindow(NSWindow *window, double x, double y) {
  return NSMakePoint(x, window.contentView.frame.size.height - y);
}

CGPoint onScreen(NSWindow *window, double x, double y) {
  NSPoint screen = [window convertPointToScreen:inWindow(window, x, y)];
  CGFloat top = NSScreen.screens.firstObject.frame.size.height;
  return CGPointMake(screen.x, top - screen.y);
}

void sendCGEvent(NSWindow *window, CGEventRef cg, double x, double y) {
  CGEventSetLocation(cg, onScreen(window, x, y));
  // The window under the pointer, which NSEvent takes its window and its location in it from.
  CGEventSetIntegerValueField(cg, kCGMouseEventWindowUnderMousePointer, window.windowNumber);
  CGEventSetIntegerValueField(cg, kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent, window.windowNumber);
  NSEvent *event = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  if (event != nil) {
    [NSApp sendEvent:event];
  }
}

// The view the replayed press went to. NSWindow sends a real drag to the view its press hit; it
// drops a made-up drag when no button is down in hardware (NSEvent.pressedMouseButtons), so the
// replay hands the drag and the release to that view itself, as the window would.
NSView *__weak gPressedView;

void sendMouse(NSWindow *window, NSEventType type, double x, double y) {
  NSEvent *event = [NSEvent mouseEventWithType:type
                                      location:inWindow(window, x, y)
                                 modifierFlags:0
                                     timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:window.windowNumber
                                       context:nil
                                   eventNumber:0
                                    clickCount:1
                                      pressure:type == NSEventTypeLeftMouseUp || type == NSEventTypeMouseMoved ? 0 : 1];
  if (type == NSEventTypeLeftMouseDown) {
    NSView *content = window.contentView;
    gPressedView = [content hitTest:[content.superview convertPoint:event.locationInWindow fromView:nil]];
  }
  NSView *pressed = gPressedView;
  if (type == NSEventTypeLeftMouseDragged && pressed != nil) {
    [pressed mouseDragged:event];
  } else if (type == NSEventTypeLeftMouseUp && pressed != nil) {
    gPressedView = nil;
    [pressed mouseUp:event];
  } else {
    [NSApp sendEvent:event];
  }
}

void play(NSWindow *window, const InputStep &step) {
  switch (step.kind) {
    case InputStep::Kind::Wait:
      break;
    case InputStep::Kind::Move:
      sendMouse(window, NSEventTypeMouseMoved, step.x, step.y);
      break;
    case InputStep::Kind::Down:
      sendMouse(window, NSEventTypeLeftMouseDown, step.x, step.y);
      break;
    case InputStep::Kind::Drag:
      sendMouse(window, NSEventTypeLeftMouseDragged, step.x, step.y);
      break;
    case InputStep::Kind::Up:
      sendMouse(window, NSEventTypeLeftMouseUp, step.x, step.y);
      break;
    case InputStep::Kind::Scroll: {
      // AppKit's deltas move the content: the fingers' movement, as with natural scrolling off.
      CGEventRef cg = CGEventCreateScrollWheelEvent2(
          nullptr, kCGScrollEventUnitPixel, 2, static_cast<int32_t>(-step.dy), static_cast<int32_t>(-step.amount), 0);
      CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, 1);
      int64_t phase = step.phase == GesturePhase::Began ? kCGScrollPhaseBegan
          : step.phase == GesturePhase::Changed         ? kCGScrollPhaseChanged
          : step.phase == GesturePhase::Ended           ? kCGScrollPhaseEnded
                                                        : 0;
      CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, phase);
      sendCGEvent(window, cg, step.x, step.y);
      break;
    }
    case InputStep::Kind::Magnify:
    case InputStep::Kind::Rotate: {
      // A gesture event (29), its HID type zoom (8) or rotation (5) in field 110, its amount in 113
      // or 114 and its phase in 132: how the trackpad's own reach the app.
      bool magnify = step.kind == InputStep::Kind::Magnify;
      CGEventRef cg = CGEventCreate(nullptr);
      CGEventSetType(cg, static_cast<CGEventType>(29));
      CGEventSetIntegerValueField(cg, static_cast<CGEventField>(110), magnify ? 8 : 5);
      CGEventSetDoubleValueField(cg, static_cast<CGEventField>(magnify ? 113 : 114), step.amount);
      CGEventSetIntegerValueField(cg, static_cast<CGEventField>(132), hidPhase(step.phase));
      sendCGEvent(window, cg, step.x, step.y);
      break;
    }
  }
}

void playFrom(NSWindow *window, std::shared_ptr<InputScript> script, size_t at) {
  while (at < script->steps.size()) {
    const auto &step = script->steps[at++];
    if (step.kind == InputStep::Kind::Wait) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(step.amount * NSEC_PER_MSEC)),
                     dispatch_get_main_queue(), ^{
                       playFrom(window, script, at);
                     });
      return;
    }
    play(window, step);
  }
  fprintf(stderr, "[ngn] input script done\n");
}

} // namespace

void replayInputScript(NSWindow *window, InputScript script) {
  // A click in a window that is not key only brings it forward, as a person's first click does.
  [NSApp activateIgnoringOtherApps:YES];
  [window makeKeyAndOrderFront:nil];
  playFrom(window, std::make_shared<InputScript>(std::move(script)), 0);
}

} // namespace ngn::appkit
