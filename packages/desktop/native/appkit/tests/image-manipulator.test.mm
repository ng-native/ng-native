// ImageIOCodec (image-manipulator.mm) editing images generated in memory, read back pixel by pixel.
#include "../image-manipulator.h"

#include <doctest/doctest.h>

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <array>

using ngn::ImageSize;
using ngn::ImageStep;
using Kind = ngn::ImageStep::Kind;
using Pixel = std::array<int, 4>;

namespace {

const Pixel kRed{255, 0, 0, 255}, kBlue{0, 0, 255, 255}, kGreen{0, 255, 0, 255};

// A `width` by `height` image whose pixel at (x, y) from the top left is `paint(x, y)`, encoded
// as `type`, with an EXIF `orientation` when one is given.
template <typename Paint>
std::string encode(int width, int height, Paint paint, NSString *type = UTTypePNG.identifier, int orientation = 0) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width * height * 4));
  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      Pixel p = paint(x, y);
      std::copy(p.begin(), p.end(), pixels.begin() + (y * width + x) * 4);
    }
  }
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(
      pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGImageRef image = CGBitmapContextCreateImage(context);
  NSMutableData *data = [NSMutableData data];
  CGImageDestinationRef destination =
      CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, (__bridge CFStringRef)type, 1, nullptr);
  NSDictionary *properties = orientation ? @{(__bridge NSString *)kCGImagePropertyOrientation : @(orientation)} : @{};
  CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
  CGImageDestinationFinalize(destination);
  CFRelease(destination);
  CGImageRelease(image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return std::string(static_cast<const char *>(data.bytes), data.length);
}

// Red on the left half, blue on the right: 20 by 10.
std::string halves(NSString *type = UTTypePNG.identifier, int orientation = 0) {
  return encode(20, 10, [](int x, int) { return x < 10 ? kRed : kBlue; }, type, orientation);
}

// A decoded image: its size, its type, and its pixels from the top left.
struct Decoded {
  int width{0}, height{0};
  std::string type;
  std::vector<uint8_t> pixels;
  Pixel at(int x, int y) const {
    auto i = static_cast<size_t>((y * width + x) * 4);
    return {pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]};
  }
};

Decoded decode(const std::string &bytes) {
  NSData *data = [NSData dataWithBytes:bytes.data() length:bytes.size()];
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr);
  REQUIRE(source);
  CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, nullptr);
  Decoded decoded;
  decoded.type = [(__bridge NSString *)CGImageSourceGetType(source) UTF8String];
  decoded.width = static_cast<int>(CGImageGetWidth(image));
  decoded.height = static_cast<int>(CGImageGetHeight(image));
  decoded.pixels.resize(static_cast<size_t>(decoded.width * decoded.height * 4));
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(
      decoded.pixels.data(), decoded.width, decoded.height, 8, decoded.width * 4, space,
      kCGImageAlphaPremultipliedLast);
  CGContextDrawImage(context, CGRectMake(0, 0, decoded.width, decoded.height), image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  CGImageRelease(image);
  CFRelease(source);
  return decoded;
}

// Close to `want`, as a lossy format keeps it.
bool near(Pixel got, Pixel want, int tolerance = 24) {
  for (size_t i = 0; i < 4; i++) {
    if (std::abs(got[i] - want[i]) > tolerance) {
      return false;
    }
  }
  return true;
}

Decoded edit(const std::string &bytes, std::vector<ImageStep> steps, const std::string &format = "png", double quality = 1) {
  auto codec = ngn::appkit::makeImageCodec();
  return decode(codec->render(bytes, steps, format, quality));
}

ImageStep step(Kind kind, ImageSize size) {
  return {.kind = kind, .size = size};
}

} // namespace

TEST_CASE("ImageIOCodec reads an image's size the right way up, and nothing from bytes that are not one") {
  auto codec = ngn::appkit::makeImageCodec();
  CHECK(codec->size(halves()) == ImageSize{20, 10});
  // EXIF orientation 6 shows the stored image turned a quarter clockwise.
  CHECK(codec->size(halves(UTTypeJPEG.identifier, 6)) == ImageSize{10, 20});
  CHECK_FALSE(codec->size("hello"));
  CHECK(codec->encodes("jpeg"));
  CHECK(codec->encodes("png"));
}

TEST_CASE("ImageIOCodec decodes the image the right way up before editing it") {
  auto upright = edit(halves(UTTypeJPEG.identifier, 6), {});
  CHECK(upright.width == 10);
  CHECK(upright.height == 20);
  // Turned a quarter clockwise, the left half (red) is at the top.
  CHECK(near(upright.at(5, 2), kRed));
  CHECK(near(upright.at(5, 17), kBlue));
}

TEST_CASE("ImageIOCodec resizes, flips and crops") {
  auto small = edit(halves(), {step(Kind::Resize, {10, 5})});
  CHECK(small.width == 10);
  CHECK(small.height == 5);
  CHECK(near(small.at(1, 2), kRed));
  CHECK(near(small.at(8, 2), kBlue));

  auto mirrored = edit(halves(), {step(Kind::FlipHorizontal, {20, 10})});
  CHECK(mirrored.at(0, 0) == kBlue);
  CHECK(mirrored.at(19, 9) == kRed);

  auto topGreen = encode(4, 6, [](int, int y) { return y < 3 ? kGreen : kRed; });
  auto upsideDown = edit(topGreen, {step(Kind::FlipVertical, {4, 6})});
  CHECK(upsideDown.at(0, 0) == kRed);
  CHECK(upsideDown.at(3, 5) == kGreen);

  ImageStep crop = step(Kind::Crop, {6, 4});
  crop.x = 12;
  crop.y = 3;
  auto right = edit(halves(), {crop});
  CHECK(right.width == 6);
  CHECK(right.height == 4);
  CHECK(right.at(0, 0) == kBlue);
  CHECK(right.at(5, 3) == kBlue);
  // From the top left: a crop of the top rows of a green-over-red image is green.
  ImageStep top = step(Kind::Crop, {4, 2});
  CHECK(edit(topGreen, {top}).at(0, 1) == kGreen);
}

TEST_CASE("ImageIOCodec rotates clockwise, and each step edits what the one before gave") {
  ImageStep quarter = step(Kind::Rotate, {10, 20});
  quarter.degrees = 90;
  auto turned = edit(halves(), {quarter});
  CHECK(turned.width == 10);
  CHECK(turned.height == 20);
  CHECK(near(turned.at(5, 2), kRed));
  CHECK(near(turned.at(5, 17), kBlue));
  // Turned a quarter clockwise, then flipped top to bottom: blue on top.
  auto both = edit(halves(), {quarter, step(Kind::FlipVertical, {10, 20})});
  CHECK(near(both.at(5, 2), kBlue));
  ImageStep back = quarter;
  back.degrees = -90;
  back.size = {20, 10};
  auto there = edit(halves(), {quarter, back});
  CHECK(near(there.at(2, 5), kRed));
  CHECK(near(there.at(17, 5), kBlue));
}

TEST_CASE("ImageIOCodec encodes JPEG at the quality asked and PNG losslessly") {
  auto noise = encode(64, 64, [](int x, int y) {
    return Pixel{(x * 37 + y * 11) % 256, (x * 7 + y * 53) % 256, (x * y) % 256, 255};
  });
  auto codec = ngn::appkit::makeImageCodec();
  auto best = codec->render(noise, {}, "jpeg", 1);
  auto worst = codec->render(noise, {}, "jpeg", 0.1);
  CHECK(decode(best).type == "public.jpeg");
  CHECK(worst.size() < best.size() / 2);
  auto png = decode(codec->render(noise, {}, "png", 0.1));
  CHECK(png.type == "public.png");
  CHECK(png.at(10, 20) == Pixel{(10 * 37 + 20 * 11) % 256, (10 * 7 + 20 * 53) % 256, 200, 255});
  CHECK_THROWS_WITH(codec->render("hello", {}, "png", 1), "Image cannot be found");
}
