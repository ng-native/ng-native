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
