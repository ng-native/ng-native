// `<expo-image>`'s decoding and drawing (expo-image-drawing.mm) into bitmaps with no window: a
// generated PNG decoded, placed by contentFit and contentPosition, tinted and blurred, and a
// blurhash placeholder drawn.
#include "../expo-image-drawing.h"

#include <doctest/doctest.h>

#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <react/renderer/graphics/Color.h>

#include <array>

using Pixel = std::array<int, 4>;

namespace {

// A PNG `width` by `height`, its left half red and its right half blue.
std::string halvesPng(int width, int height) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width * height * 4));
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      auto *p = &pixels[static_cast<size_t>((y * width + x) * 4)];
      bool left = x < width / 2;
      p[0] = left ? 255 : 0;
      p[2] = left ? 0 : 255;
      p[3] = 255;
    }
  }
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGImageRef image = CGBitmapContextCreateImage(context);
  NSMutableData *data = [NSMutableData data];
  CGImageDestinationRef destination =
      CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, (__bridge CFStringRef)UTTypePNG.identifier, 1, nullptr);
  CGImageDestinationAddImage(destination, image, nullptr);
  CGImageDestinationFinalize(destination);
  CFRelease(destination);
  CGImageRelease(image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return std::string(static_cast<const char *>(data.bytes), data.length);
}

struct Drawn {
  int width, height;
  std::vector<uint8_t> pixels;
  Pixel at(int x, int y) const {
    auto i = static_cast<size_t>((y * width + x) * 4);
    return {pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]};
  }
};

template <typename Paint>
Drawn draw(int width, int height, Paint paint) {
  Drawn drawn{width, height, std::vector<uint8_t>(static_cast<size_t>(width * height * 4))};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(drawn.pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  // Flipped, as a view's is.
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  paint(context);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return drawn;
}

bool isRed(Pixel p) {
  return p[0] > 200 && p[2] < 50 && p[3] > 200;
}
bool isBlue(Pixel p) {
  return p[2] > 200 && p[0] < 50 && p[3] > 200;
}

} // namespace

TEST_CASE("decodeImage reads a PNG's pixels, media type and frame count, and refuses what is not an image") {
  auto decoded = ngn::appkit::decodeImage(halvesPng(40, 20));
  REQUIRE(decoded);
  CHECK(CGImageGetWidth(decoded->image) == 40);
  CHECK(CGImageGetHeight(decoded->image) == 20);
  CHECK(decoded->mediaType == "image/png");
  CHECK_FALSE(decoded->animated);
  CHECK_FALSE(ngn::appkit::decodeImage("not an image"));
}

TEST_CASE("drawImage places the image by contentFit and contentPosition in a view's flipped space") {
  auto decoded = ngn::appkit::decodeImage(halvesPng(40, 20));
  REQUIRE(decoded);
  CGImageRef image = decoded->image;
  // contain in 40x40: 40x20 in the middle band, red on the left, nothing above or below.
  auto contain = draw(40, 40, [&](CGContextRef c) { ngn::appkit::drawImage(c, image, "contain", nullptr, CGSizeMake(40, 40), {}, 0); });
  CHECK(isRed(contain.at(5, 20)));
  CHECK(isBlue(contain.at(35, 20)));
  CHECK(contain.at(20, 3)[3] == 0);
  CHECK(contain.at(20, 36)[3] == 0);
  // contain at the top: the band is at y 0 to 20.
  auto top = draw(40, 40, [&](CGContextRef c) {
    ngn::appkit::drawImage(c, image, "contain", folly::dynamic::object("top", 0), CGSizeMake(40, 40), {}, 0);
  });
  CHECK(isRed(top.at(5, 5)));
  CHECK(top.at(20, 30)[3] == 0);
  // cover in 40x40 shows the middle 20 of 40: half red, half blue, all filled.
  auto cover = draw(40, 40, [&](CGContextRef c) { ngn::appkit::drawImage(c, image, "cover", nullptr, CGSizeMake(40, 40), {}, 0); });
  CHECK(isRed(cover.at(5, 2)));
  CHECK(isBlue(cover.at(35, 38)));
  // cover from the left: only the red half shows.
  auto left = draw(40, 40, [&](CGContextRef c) {
    ngn::appkit::drawImage(c, image, "cover", folly::dynamic::object("left", 0), CGSizeMake(40, 40), {}, 0);
  });
  CHECK(isRed(left.at(35, 20)));
}

TEST_CASE("drawImage fills the image's shape with the tint, and blurs by the radius") {
  auto decoded = ngn::appkit::decodeImage(halvesPng(40, 20));
  REQUIRE(decoded);
  auto green = facebook::react::colorFromComponents({0, 1, 0, 1});
  auto tinted = draw(40, 20, [&](CGContextRef c) { ngn::appkit::drawImage(c, decoded->image, "fill", nullptr, CGSizeMake(40, 20), green, 0); });
  CHECK(tinted.at(5, 10)[1] > 200);
  CHECK(tinted.at(5, 10)[0] < 50);
  CHECK(tinted.at(35, 10)[1] > 200);

  auto sharp = draw(40, 20, [&](CGContextRef c) { ngn::appkit::drawImage(c, decoded->image, "fill", nullptr, CGSizeMake(40, 20), {}, 0); });
  auto soft = draw(40, 20, [&](CGContextRef c) { ngn::appkit::drawImage(c, decoded->image, "fill", nullptr, CGSizeMake(40, 20), {}, 4); });
  // At the seam the sharp image is all red or all blue; the blurred one mixes them.
  CHECK(sharp.at(19, 10)[2] < 30);
  CHECK(soft.at(19, 10)[0] > 60);
  CHECK(soft.at(19, 10)[2] > 60);
  // Away from the seam it keeps its colour.
  CHECK(isRed(soft.at(2, 10)));
}

TEST_CASE("A blurhash placeholder draws as its decoded colour") {
  auto pixels = ngn::decodeHashUri("blurhash:/00TI%3Aj", 8, 8);
  REQUIRE(pixels);
  CGImageRef image = ngn::appkit::imageOfPixels(*pixels);
  REQUIRE(image != nullptr);
  auto drawn = draw(16, 16, [&](CGContextRef c) { ngn::appkit::drawImage(c, image, "cover", nullptr, CGSizeMake(16, 16), {}, 0); });
  CGImageRelease(image);
  auto p = drawn.at(8, 8);
  CHECK(p[0] == doctest::Approx(pixels->rgba[0]).epsilon(0.02));
  CHECK(p[1] == doctest::Approx(pixels->rgba[1]).epsilon(0.05));
  CHECK(p[3] == 255);
}
