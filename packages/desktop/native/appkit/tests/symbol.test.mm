// The SF Symbol drawing of `<expo-symbol>` (symbol-drawing.mm), into a bitmap with no window.
#include "../symbol-drawing.h"

#include <doctest/doctest.h>

#include <array>
#include <vector>

using facebook::react::colorFromRGBA;
using Pixel = std::array<int, 4>;

namespace {

// A `width` by `height` RGBA bitmap, flipped as a view's is, with the symbol drawn into it.
struct Drawn {
  int width, height;
  std::vector<uint8_t> pixels;
  Pixel at(int x, int y) const {
    auto i = static_cast<size_t>((y * width + x) * 4);
    return {pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]};
  }
  // How many pixels are mostly `channel` (0 red, 1 green, 2 blue) and opaque.
  int mostly(int channel) const {
    int count = 0;
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        auto p = at(x, y);
        if (p[3] > 200 && p[channel] > 160 && p[(channel + 1) % 3] < 90 && p[(channel + 2) % 3] < 90) {
          count++;
        }
      }
    }
    return count;
  }
  // The box around every pixel with any ink: {left, top, right, bottom}, or all -1 for none.
  std::array<int, 4> inked() const {
    std::array<int, 4> box{-1, -1, -1, -1};
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        if (at(x, y)[3] > 40) {
          box = box[0] < 0 ? std::array<int, 4>{x, y, x, y}
                           : std::array<int, 4>{std::min(box[0], x), std::min(box[1], y), std::max(box[2], x), std::max(box[3], y)};
        }
      }
    }
    return box;
  }
};

Drawn draw(const ngn::SymbolProps &props, int width = 64, int height = 64) {
  Drawn drawn{width, height, std::vector<uint8_t>(static_cast<size_t>(width * height * 4))};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(drawn.pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  ngn::appkit::drawSymbol(context, props, CGSizeMake(width, height));
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return drawn;
}

ngn::SymbolProps symbol(const char *name) {
  ngn::SymbolProps props;
  props.name = name;
  return props;
}

} // namespace

TEST_CASE("drawSymbol draws a monochrome symbol in its tint, filling the view it is fitted to") {
  auto props = symbol("circle.fill");
  props.tintColor = colorFromRGBA(255, 0, 0, 255);
  props.resizeMode = "scaleToFill";
  auto drawn = draw(props);
  auto centre = drawn.at(32, 32);
  CHECK(centre[0] > 200);
  CHECK(centre[1] < 60);
  CHECK(centre[3] > 200);
  // The circle reaches near each edge, and its corners are empty.
  auto box = drawn.inked();
  CHECK(box[0] <= 4);
  CHECK(box[2] >= 59);
  CHECK(drawn.at(0, 0)[3] == 0);
}

TEST_CASE("drawSymbol colours a hierarchical symbol in the system blue, and a palette's layers each in theirs") {
  auto layered = symbol("circle.fill");
  layered.type = "hierarchical";
  // The system blue: no red, some green, all blue.
  auto blue = draw(layered).at(32, 32);
  CHECK(blue[0] < 60);
  CHECK(blue[2] > 220);
  CHECK(blue[3] > 200);
  auto palette = symbol("cloud.sun.fill");
  palette.type = "palette";
  palette.colors = {colorFromRGBA(255, 0, 0, 255), colorFromRGBA(0, 255, 0, 255)};
  auto drawn = draw(palette);
  CHECK(drawn.mostly(0) > 50);
  CHECK(drawn.mostly(1) > 50);
  // Without the palette, one colour.
  palette.type = "monochrome";
  palette.tintColor = colorFromRGBA(255, 0, 0, 255);
  auto one = draw(palette);
  CHECK(one.mostly(0) > 50);
  CHECK(one.mostly(1) == 0);
}

TEST_CASE("drawSymbol places the symbol by its resize mode, and draws nothing for a name with no symbol") {
  auto props = symbol("square.fill");
  props.resizeMode = "topLeft";
  auto corner = draw(props, 100, 100).inked();
  REQUIRE(corner[0] >= 0);
  // At its own size, about the system font's, in the top left corner.
  CHECK(corner[0] < 4);
  CHECK(corner[1] < 6);
  CHECK(corner[2] < 24);
  CHECK(corner[3] < 24);
  props.resizeMode = "bottomRight";
  auto opposite = draw(props, 100, 100).inked();
  CHECK(opposite[2] > 95);
  CHECK(opposite[3] > 93);
  CHECK(opposite[0] > 76);
  bool none = ngn::appkit::symbolImage(symbol("no.such.symbol.anywhere")) == nil;
  CHECK(none);
  CHECK(draw(symbol("no.such.symbol.anywhere")).inked()[0] == -1);
}

TEST_CASE("AppKitSymbolMeasurer sizes a symbol's image by its point size, weight and scale") {
  auto measurer = ngn::appkit::makeSymbolMeasurer();
  auto small = measurer->imageSize("heart.fill", 12, "", "");
  auto large = measurer->imageSize("heart.fill", 48, "", "");
  REQUIRE(small);
  REQUIRE(large);
  CHECK(large->first > small->first * 3);
  CHECK(large->second > small->second * 3);
  auto bigScale = measurer->imageSize("heart.fill", 48, "", "large");
  CHECK(bigScale->second > large->second);
  auto heavy = measurer->imageSize("plus", 48, "black", "");
  auto light = measurer->imageSize("plus", 48, "ultraLight", "");
  CHECK(heavy->first != light->first);
  CHECK_FALSE(measurer->imageSize("no.such.symbol.anywhere", 12, "", ""));
}

TEST_CASE("drawSymbol draws a symbol the right way up in a flipped view") {
  auto props = symbol("arrow.up");
  props.resizeMode = "scaleToFill";
  auto drawn = draw(props);
  auto inkAcross = [&](int y) {
    int count = 0;
    for (int x = 0; x < drawn.width; x++) {
      count += drawn.at(x, y)[3] > 40 ? 1 : 0;
    }
    return count;
  };
  // The arrow's head, at the top, is wider than its shaft, at the bottom.
  CHECK(inkAcross(16) > inkAcross(56) * 2);
}
