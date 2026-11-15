// The buttons a pointer event carries (pointer-buttons.h).
#include "../pointer-buttons.h"

#include <doctest/doctest.h>

namespace {

NSEvent *mouse(NSEventType type) {
  return [NSEvent mouseEventWithType:type
                            location:NSZeroPoint
                       modifierFlags:0
                           timestamp:0
                        windowNumber:0
                             context:nil
                         eventNumber:0
                          clickCount:1
                            pressure:1];
}

} // namespace

TEST_CASE("The buttons an event carries are those its own delivery leaves held, not the hardware's now") {
  int held = NGNButtonsAfter(0, mouse(NSEventTypeLeftMouseDown));
  CHECK(held == 1);
  // A drag queued before the release still has the button down, whatever the mouse is doing now.
  held = NGNButtonsAfter(held, mouse(NSEventTypeLeftMouseDragged));
  CHECK(held == 1);
  held = NGNButtonsAfter(held, mouse(NSEventTypeRightMouseDown));
  CHECK(held == 3);
  held = NGNButtonsAfter(held, mouse(NSEventTypeLeftMouseUp));
  CHECK(held == 2);
  CHECK(NGNButtonsAfter(held, mouse(NSEventTypeRightMouseUp)) == 0);
  CHECK(NGNButtonsAfter(held, mouse(NSEventTypeMouseMoved)) == 0);
  NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                  location:NSZeroPoint
                             modifierFlags:0
                                 timestamp:0
                              windowNumber:0
                                   context:nil
                                characters:@"a"
               charactersIgnoringModifiers:@"a"
                                 isARepeat:NO
                                   keyCode:0];
  CHECK(NGNButtonsAfter(held, key) == 2);
}
