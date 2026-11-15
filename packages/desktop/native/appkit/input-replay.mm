#include "input-replay.h"

#include <memory>

namespace ngn::appkit {

namespace {

std::function<NSEvent *(NSEvent *, NSWindow *)> gScrollMonitor;

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
  if (event == nil) {
    return;
  }
  // A made-up scroll or gesture gets a window only where the window server would send it, under
  // the real pointer: elsewhere NSApp drops it, so the window takes it and sends it to the view
  // under its point, as it does a real one.
  if (event.window == window) {
    [NSApp sendEvent:event];
    return;
  }
  if (event.type == NSEventTypeScrollWheel && gScrollMonitor) {
    event = gScrollMonitor(event, window);
  }
  if (event != nil) {
    [window sendEvent:event];
  }
}

// The view the replayed press went to. NSWindow sends a real drag to the view its press hit; it
// drops a made-up drag when no button is down in hardware (NSEvent.pressedMouseButtons), so the
// replay hands the drag and the release to that view itself, as the window would.
NSView *__weak gPressedView;
// Whether the press has dragged: its release then goes to the pressed view too.
bool gDragged = false;

// Whether a replayed press is still being handled: a view tracking it in a loop of its own reads
// the release from the event queue, where it is posted.
bool gInPress = false;

void sendMouse(NSWindow *window, NSEventType type, double x, double y) {
  NSEvent *event = [NSEvent mouseEventWithType:type
                                      location:inWindow(window, x, y)
                                 modifierFlags:0
                                     timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:window.windowNumber
                                       context:nil
                                   eventNumber:0
                                    clickCount:1
                                      pressure:type == NSEventTypeLeftMouseUp || type == NSEventTypeRightMouseUp || type == NSEventTypeMouseMoved ? 0 : 1];
  if (type == NSEventTypeLeftMouseDown) {
    gDragged = false;
    NSView *content = window.contentView;
    gPressedView = [content hitTest:[content.superview convertPoint:event.locationInWindow fromView:nil]];
  }
  NSView *pressed = gPressedView;
  if (type == NSEventTypeLeftMouseDragged && pressed != nil) {
    gDragged = true;
    [pressed mouseDragged:event];
  } else if (type == NSEventTypeLeftMouseUp && pressed != nil && gDragged) {
    gPressedView = nil;
    gDragged = false;
    [pressed mouseUp:event];
  } else {
    // A click's release goes through the window as a real one does, so a view that tracks the
    // press through the window (SwiftUI's controls, AppKit's own) sees it end.
    if (type == NSEventTypeLeftMouseUp) {
      gPressedView = nil;
      if (gInPress) {
        [NSApp postEvent:event atStart:NO];
        return;
      }
    }
    bool press = type == NSEventTypeLeftMouseDown;
    gInPress = gInPress || press;
    [NSApp sendEvent:event];
    if (press) {
      gInPress = false;
    }
  }
}

// A key press and its release, to the key window (a red box or a sheet, not only the app's).
void sendKey(NSWindow *scriptWindow, const InputStep &step) {
  NSWindow *window = NSApp.keyWindow != nil ? NSApp.keyWindow : scriptWindow;
  NSString *characters = step.key == "escape" ? @"\x1b"
      : step.key == "return"                  ? @"\r"
      : step.key == "space"                   ? @" "
      : step.key == "tab"                     ? @"\t"
      : step.key == "delete"                  ? @"\x7f"
                                              : [NSString stringWithUTF8String:step.key.c_str()];
  unsigned short code = step.key == "escape" ? 53
      : step.key == "return"                 ? 36
      : step.key == "space"                  ? 49
      : step.key == "tab"                    ? 48
      : step.key == "delete"                 ? 51
                                             : 0;
  // A character typed into text goes in as the input method puts it, through NSTextInputClient: a
  // made-up key event reaches the field editor's keyDown, but the text system inserts nothing for
  // one no keyboard sent.
  bool typed = (step.key.size() == 1 || step.key == "space") &&
      (step.modifiers & (InputStep::Command | InputStep::Control)) == 0;
  id responder = window.firstResponder;
  if (typed && [responder conformsToProtocol:@protocol(NSTextInputClient)]) {
    [(id<NSTextInputClient>)responder insertText:characters replacementRange:NSMakeRange(NSNotFound, 0)];
    return;
  }
  NSEventModifierFlags flags = 0;
  if (step.modifiers & InputStep::Command) flags |= NSEventModifierFlagCommand;
  if (step.modifiers & InputStep::Shift) flags |= NSEventModifierFlagShift;
  if (step.modifiers & InputStep::Option) flags |= NSEventModifierFlagOption;
  if (step.modifiers & InputStep::Control) flags |= NSEventModifierFlagControl;
  for (NSEventType type : {NSEventTypeKeyDown, NSEventTypeKeyUp}) {
    NSEvent *event = [NSEvent keyEventWithType:type
                                      location:NSZeroPoint
                                 modifierFlags:flags
                                     timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:window.windowNumber
                                       context:nil
                                    characters:characters
                   charactersIgnoringModifiers:characters
                                     isARepeat:NO
                                       keyCode:code];
    [NSApp sendEvent:event];
  }
}

// Types `text` into the key window's focused field (the script's window's when none is key) a character at a time, each as the input
// method puts a keystroke's character, so the text system's substitutions and capitals follow
// each one as they follow typing.
void typeText(NSWindow *window, NSString *text) {
  id responder = (NSApp.keyWindow != nil ? NSApp.keyWindow : window).firstResponder;
  if (![responder conformsToProtocol:@protocol(NSTextInputClient)]) {
    return;
  }
  [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                           options:NSStringEnumerationByComposedCharacterSequences
                        usingBlock:^(NSString *character, NSRange, NSRange, BOOL *) {
                          [(id<NSTextInputClient>)responder insertText:character
                                                     replacementRange:NSMakeRange(NSNotFound, 0)];
                        }];
}

// The title a choose step left for the next menu to open, and the observer waiting for it.
NSString *gChoice;
id gMenuObserver;

// Picks the item titled `title` in `menu`, or in a submenu of it, as a click on it does, and
// closes the menu. Whether one was found.
bool pick(NSMenu *menu, NSString *title) {
  for (NSInteger i = 0; i < menu.numberOfItems; i++) {
    NSMenuItem *item = [menu itemAtIndex:i];
    if ([item.title isEqualToString:title] && item.enabled && !item.hidden) {
      [menu cancelTrackingWithoutAnimation];
      [menu performActionForItemAtIndex:i];
      return true;
    }
    if (item.submenu != nil && pick(item.submenu, title)) {
      [menu cancelTrackingWithoutAnimation];
      return true;
    }
  }
  return false;
}

void chooseInNextMenu(NSString *title) {
  gChoice = title;
  if (gMenuObserver != nil) {
    return;
  }
  gMenuObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:NSMenuDidBeginTrackingNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification *note) {
                NSMenu *menu = note.object;
                NSString *choice = gChoice;
                // A submenu opening within the menu being chosen from is not the next menu.
                if (choice == nil || menu.supermenu != nil) {
                  return;
                }
                gChoice = nil;
                // A second open first, so the menu can be seen; the menu's tracking runs the
                // main queue.
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                  if (!pick(menu, choice)) {
                    fprintf(stderr, "[ngn] input script: the menu has no item %s\n", choice.UTF8String);
                    [menu cancelTracking];
                  }
                });
              }];
}

void play(NSWindow *window, const InputStep &step) {
  switch (step.kind) {
    case InputStep::Kind::Choose:
      chooseInNextMenu([NSString stringWithUTF8String:step.key.c_str()]);
      break;
    case InputStep::Kind::Key:
      sendKey(window, step);
      break;
    case InputStep::Kind::Type:
      typeText(window, [NSString stringWithUTF8String:step.key.c_str()]);
      break;
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
    case InputStep::Kind::Secondary:
      sendMouse(window, NSEventTypeRightMouseDown, step.x, step.y);
      sendMouse(window, NSEventTypeRightMouseUp, step.x, step.y);
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

void playFrom(NSWindow *window, std::shared_ptr<InputScript> script, size_t at);

// Plays the steps from `at` after `ms`, from a run loop timer in the common modes rather than a
// main-queue block: a press a view tracks in a loop of its own (a table's row, a text field)
// holds up the main queue's blocks until it returns, while its loop still fires these timers.
void playLater(NSWindow *window, std::shared_ptr<InputScript> script, size_t at, double ms) {
  NSTimer *timer = [NSTimer timerWithTimeInterval:ms / 1000
                                          repeats:NO
                                            block:^(NSTimer *) {
                                              playFrom(window, script, at);
                                            }];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}

void playFrom(NSWindow *window, std::shared_ptr<InputScript> script, size_t at) {
  while (at < script->steps.size()) {
    const auto &step = script->steps[at++];
    if (step.kind == InputStep::Kind::Wait) {
      playLater(window, script, at, step.amount);
      return;
    }
    if (step.kind == InputStep::Kind::Down) {
      // The steps after a press go on from a timer, which fires inside the press's tracking loop
      // where a view runs one: its release is then posted for the loop to read (sendMouse).
      playLater(window, script, at, 0);
      play(window, step);
      return;
    }
    play(window, step);
  }
  fprintf(stderr, "[ngn] input script done\n");
}

} // namespace

void playInputStep(NSWindow *window, const InputStep &step) {
  if (step.kind != InputStep::Kind::Wait) {
    play(window, step);
  }
}

void setReplayScrollMonitor(std::function<NSEvent *(NSEvent *, NSWindow *)> monitor) {
  gScrollMonitor = std::move(monitor);
}

void replayInputScript(NSWindow *window, InputScript script) {
  // A click in a window that is not key only brings it forward, as a person's first click does.
  [NSApp activateIgnoringOtherApps:YES];
  [window makeKeyAndOrderFront:nil];
  playFrom(window, std::make_shared<InputScript>(std::move(script)), 0);
}

} // namespace ngn::appkit
