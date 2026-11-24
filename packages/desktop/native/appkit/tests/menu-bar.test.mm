// The key equivalents the menu bar gives its items (menu-bar.h).
#include "../menu-bar.h"

#include <doctest/doctest.h>

#include <utility>

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

TEST_CASE("A key press is named as the web names it, F13 to F20 too, and a character key is left to its character") {
  // The virtual key codes of Carbon's Events.h (kVK_*).
  CHECK([ngn::appkit::keyName(123) isEqualToString:@"ArrowLeft"]);
  CHECK([ngn::appkit::keyName(76) isEqualToString:@"Enter"]);
  CHECK([ngn::appkit::keyName(111) isEqualToString:@"F12"]);
  const std::pair<unsigned short, NSString *> past12[] = {{105, @"F13"}, {107, @"F14"}, {113, @"F15"}, {106, @"F16"},
                                                          {64, @"F17"},  {79, @"F18"},  {80, @"F19"},  {90, @"F20"}};
  for (const auto &[code, name] : past12) {
    CAPTURE(code);
    CHECK([ngn::appkit::keyName(code) isEqualToString:name]);
  }
  // The letter k.
  CHECK((ngn::appkit::keyName(40) == nil));
}

namespace {

// The alpha of `image` drawn `size` points square at 1x, at the pixel (x, y) from its top left.
CGFloat alphaAt(NSImage *image, CGFloat size, NSInteger x, NSInteger y) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil
                                                                  pixelsWide:(NSInteger)size
                                                                  pixelsHigh:(NSInteger)size
                                                               bitsPerSample:8
                                                             samplesPerPixel:4
                                                                    hasAlpha:YES
                                                                    isPlanar:NO
                                                              colorSpaceName:NSDeviceRGBColorSpace
                                                                 bytesPerRow:0
                                                                bitsPerPixel:0];
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [image drawInRect:NSMakeRect(0, 0, size, size)];
  [NSGraphicsContext restoreGraphicsState];
  return [rep colorAtX:x y:y].alphaComponent;
}

} // namespace

TEST_CASE("A menu item draws its SVG icon as a template image, and its SF Symbol in its place when it has one") {
  const std::string topHalf = R"svg(<svg viewBox="0 0 16 16"><rect width="16" height="8"/></svg>)svg";
  ngn::MenuItem svg{.title = "Rename", .command = ngn::MenuCommand::AppItem, .id = "a1", .svgIcon = topHalf};
  ngn::MenuItem symbol = svg;
  symbol.sfSymbol = "star";
  ngn::MenuItem plain{.title = "Delete", .command = ngn::MenuCommand::AppItem, .id = "a2"};
  ngn::MenuItem notSvg = plain;
  notSvg.svgIcon = "lucidePencil";
  ngn::MenuItem submenu{.title = "More", .items = {plain}, .svgIcon = topHalf};
  NSMenu *menu = ngn::appkit::buildMenu("", {svg, symbol, plain, notSvg, submenu}, [](const ngn::MenuItem &) {});
  REQUIRE(menu.numberOfItems == 5);
  NSImage *image = [menu itemAtIndex:0].image;
  REQUIRE((image != nil));
  // Tinted by AppKit for the highlight and the menu's appearance, as a symbol is.
  CHECK([image isTemplate]);
  CHECK(image.size.width == 16);
  // Drawn the right way up: its top half filled.
  CHECK(alphaAt(image, 16, 8, 2) == doctest::Approx(1));
  CHECK(alphaAt(image, 16, 8, 13) == doctest::Approx(0));
  // An SF Symbol wins.
  NSImage *star = [menu itemAtIndex:1].image;
  REQUIRE((star != nil));
  CHECK(star.size.width != 16);
  CHECK(([menu itemAtIndex:2].image == nil));
  // Markup that is no svg is no icon.
  CHECK(([menu itemAtIndex:3].image == nil));
  // A submenu's item has its icon too.
  CHECK(([menu itemAtIndex:4].image != nil));
  CHECK(([menu itemAtIndex:4].submenu != nil));
}
