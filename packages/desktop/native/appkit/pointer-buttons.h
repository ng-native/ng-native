// The mouse buttons held as an event is delivered, as a bit mask (1 the primary, 2 the secondary,
// 4 the middle, as NSEvent.pressedMouseButtons counts them). Kept from the events themselves:
// pressedMouseButtons is the hardware's state now, which a queued drag can be behind.
#pragma once

#import <AppKit/AppKit.h>

// The buttons held once `event` is delivered, given those held before it.
inline int NGNButtonsAfter(int held, NSEvent *event) {
  switch (event.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeLeftMouseDragged:
      return held | 1;
    case NSEventTypeLeftMouseUp:
      return held & ~1;
    case NSEventTypeRightMouseDown:
    case NSEventTypeRightMouseDragged:
      return held | 2;
    case NSEventTypeRightMouseUp:
      return held & ~2;
    case NSEventTypeOtherMouseDown:
    case NSEventTypeOtherMouseDragged:
      return held | (1 << event.buttonNumber);
    case NSEventTypeOtherMouseUp:
      return held & ~(1 << event.buttonNumber);
    case NSEventTypeMouseMoved:
      // Moves come only with no button down; a button released outside the app is let go here.
      return 0;
    default:
      return held;
  }
}
