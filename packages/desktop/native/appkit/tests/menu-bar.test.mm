// The key equivalents the menu bar gives its items (menu-bar.h).
#include "../menu-bar.h"

#include <doctest/doctest.h>

TEST_CASE("A menu item's key is one character as the user sees it, or a key the web names") {
  CHECK([ngn::appkit::keyEquivalent("q") isEqualToString:@"q"]);
  CHECK([ngn::appkit::keyEquivalent("") isEqualToString:@""]);
  // Characters past ASCII take more than one byte of UTF-8, and more than one UTF-16 unit.
  CHECK([ngn::appkit::keyEquivalent("é") isEqualToString:@"é"]);
  CHECK([ngn::appkit::keyEquivalent("ß") isEqualToString:@"ß"]);
  CHECK([ngn::appkit::keyEquivalent("😀") isEqualToString:@"😀"]);
  CHECK([ngn::appkit::keyEquivalent("Enter") isEqualToString:@"\r"]);
  CHECK([ngn::appkit::keyEquivalent("F5") isEqualToString:[NSString stringWithFormat:@"%C", (unichar)NSF5FunctionKey]]);
  // Two characters name no key.
  CHECK([ngn::appkit::keyEquivalent("ab") isEqualToString:@""]);
}

@interface NGNMenuAnchorTestView : NSView
@end
@implementation NGNMenuAnchorTestView
- (BOOL)isFlipped {
  return YES;
}
@end

TEST_CASE("A menu a press opens goes under the view, from its leading edge") {
  NSView *view = [[NGNMenuAnchorTestView alloc] initWithFrame:NSMakeRect(40, 50, 120, 30)];
  NSPoint at = ngn::appkit::menuLocationUnder(view);
  CHECK(at.x == 0);
  CHECK(at.y == 32);
  // Unflipped, the bottom edge is y 0, and the menu hangs below it.
  NSView *plain = [[NSView alloc] initWithFrame:NSMakeRect(40, 50, 120, 30)];
  at = ngn::appkit::menuLocationUnder(plain);
  CHECK(at.x == 0);
  CHECK(at.y == -2);
  // Right to left, its leading edge is the view's right.
  view.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
  at = ngn::appkit::menuLocationUnder(view);
  CHECK(at.x == 120);
  CHECK(at.y == 32);
}
