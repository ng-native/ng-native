// NGNAppleIdButton (apple-id-button.mm) drawn offscreen, in no window, into bitmaps.
#include "../apple-id-button.h"

#include <doctest/doctest.h>

namespace {

struct Drawn {
  NSBitmapImageRep *bitmap;
  // The mean brightness of the opaque pixels, 0 to 1.
  double brightness;
  // The share of the pixels that are opaque.
  double opaque;
};

Drawn draw(NSView *view) {
  [view layoutSubtreeIfNeeded];
  NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
  double sum = 0;
  long opaque = 0;
  long all = 0;
  for (NSInteger y = 0; y < bitmap.pixelsHigh; y++) {
    for (NSInteger x = 0; x < bitmap.pixelsWide; x++) {
      NSColor *colour = [[bitmap colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      all++;
      if (colour.alphaComponent > 0.9) {
        opaque++;
        sum += (colour.redComponent + colour.greenComponent + colour.blueComponent) / 3;
      }
    }
  }
  return {bitmap, opaque > 0 ? sum / opaque : 0, static_cast<double>(opaque) / all};
}

double alphaAt(NSBitmapImageRep *bitmap, NSInteger x, NSInteger y) {
  return [bitmap colorAtX:x y:y].alphaComponent;
}

} // namespace

TEST_CASE("NGNAppleIdButton draws Apple's button in expo's style, light or dark") {
  int presses = 0;
  NGNAppleIdButton *button = [[NGNAppleIdButton alloc] initWithFrame:NSMakeRect(0, 0, 240, 44) pressed:[&] { presses++; }];
  [button applyType:0 style:2 cornerRadius:0];
  REQUIRE((button.control != nil));
  CHECK(NSEqualRects(button.control.frame, button.bounds));
  auto black = draw(button);
  CHECK(black.opaque > 0.9);
  CHECK(black.brightness < 0.3);

  ASAuthorizationAppleIDButton *first = button.control;
  [button applyType:0 style:0 cornerRadius:0];
  CHECK((button.control != first));
  CHECK(button.subviews.count == 1);
  auto white = draw(button);
  CHECK(white.opaque > 0.9);
  CHECK(white.brightness > 0.7);

  // The wording changes the button too; the corners alone do not.
  ASAuthorizationAppleIDButton *signIn = button.control;
  [button applyType:1 style:0 cornerRadius:0];
  CHECK((button.control != signIn));
  ASAuthorizationAppleIDButton *continued = button.control;
  [button applyType:1 style:0 cornerRadius:12];
  CHECK((button.control == continued));
  CHECK(button.control.cornerRadius == 12);
}

TEST_CASE("NGNAppleIdButton rounds its corners by cornerRadius, and sends its action as a press") {
  int presses = 0;
  NGNAppleIdButton *button = [[NGNAppleIdButton alloc] initWithFrame:NSMakeRect(0, 0, 200, 50) pressed:[&] { presses++; }];
  [button applyType:0 style:2 cornerRadius:0];
  auto square = draw(button);
  CHECK(alphaAt(square.bitmap, 0, 0) > 0.9);
  [button applyType:0 style:2 cornerRadius:20];
  auto round = draw(button);
  CHECK(alphaAt(round.bitmap, 0, 0) < 0.1);
  CHECK(alphaAt(round.bitmap, round.bitmap.pixelsWide / 2, round.bitmap.pixelsHigh / 2) > 0.9);

  // A click sends the control's action, as AppKit does on mouse up; with no cell, performClick: does not.
  REQUIRE([button.control sendAction:button.control.action to:button.control.target]);
  CHECK(presses == 1);
}
