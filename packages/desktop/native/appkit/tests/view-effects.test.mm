// What a view's `filter` and `mix-blend-mode` become on its layer (view-effects.h): the layer
// filters run through a Core Image context whose working space is linear, as Core Animation's is.
#include "../view-effects.h"

#include <doctest/doctest.h>

#include <array>
#include <cmath>

using facebook::react::BlendMode;
using ngn::FilterStep;

namespace {

struct Pixel {
  double r, g, b, a;
};

FilterStep matrixStep(std::array<double, 20> m) {
  return {.type = FilterStep::Type::ColorMatrix, .matrix = m};
}

// The Filter Effects matrix of brightness(value) and grayscale(1), as the core builds them.
FilterStep brightness(double value) {
  return matrixStep({value, 0, 0, 0, 0, 0, value, 0, 0, 0, 0, 0, value, 0, 0, 0, 0, 0, 1, 0});
}
FilterStep grayscale() {
  return matrixStep({0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0, 0, 0, 1, 0});
}
FilterStep opacity(double value) {
  return matrixStep({1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, value, 0});
}

// `image` through `filters`, drawn in a context that works in linear sRGB, and its pixel at (x, 0)
// as straight (not premultiplied) sRGB in 0 to 1.
Pixel render(CIImage *image, NSArray<CIFilter *> *filters, int x) {
  for (CIFilter *filter in filters) {
    [filter setValue:image forKey:kCIInputImageKey];
    image = filter.outputImage;
  }
  CGColorSpaceRef linear = CGColorSpaceCreateWithName(kCGColorSpaceLinearSRGB);
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CIContext *context = [CIContext contextWithOptions:@{kCIContextWorkingColorSpace : (__bridge id)linear, kCIContextUseSoftwareRenderer : @YES}];
  uint8_t out[4] = {0, 0, 0, 0};
  [context render:image toBitmap:out rowBytes:4 bounds:CGRectMake(x, 0, 1, 1) format:kCIFormatRGBA8 colorSpace:srgb];
  CGColorSpaceRelease(linear);
  CGColorSpaceRelease(srgb);
  double a = out[3] / 255.0;
  if (a == 0) {
    return {0, 0, 0, 0};
  }
  // Premultiplied out, so each colour channel is divided back.
  return {out[0] / 255.0 / a, out[1] / 255.0 / a, out[2] / 255.0 / a, a};
}

// A row of premultiplied sRGB pixels as an image, each `width` pixels wide.
CIImage *row(std::vector<std::array<uint8_t, 4>> pixels) {
  NSMutableData *data = [NSMutableData data];
  for (auto &p : pixels) {
    [data appendBytes:p.data() length:4];
  }
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CIImage *image = [CIImage imageWithBitmapData:data
                                    bytesPerRow:pixels.size() * 4
                                           size:CGSizeMake(pixels.size(), 1)
                                         format:kCIFormatRGBA8
                                     colorSpace:srgb];
  CGColorSpaceRelease(srgb);
  return image;
}

bool near(double a, double b, double tolerance = 0.02) {
  return std::abs(a - b) <= tolerance;
}

} // namespace

TEST_CASE("A colour step runs on sRGB values, as Chrome's filters do, not on the linear working space's") {
  // The blue of the canary: grayscale(1) is 0.2126 r + 0.7152 g + 0.0722 b of the sRGB values.
  auto filters = ngn::appkit::layerFilters({grayscale()});
  auto p = render(row({{59, 110, 245, 255}}), filters, 0);
  double expected = (0.2126 * 59 + 0.7152 * 110 + 0.0722 * 245) / 255;
  CHECK(near(p.r, expected));
  CHECK(near(p.g, expected));
  CHECK(near(p.b, expected));
  CHECK(near(p.a, 1));

  auto dimmed = render(row({{200, 100, 50, 255}}), ngn::appkit::layerFilters({brightness(0.5)}), 0);
  CHECK(near(dimmed.r, 100 / 255.0));
  CHECK(near(dimmed.g, 50 / 255.0));
  CHECK(near(dimmed.b, 25 / 255.0));
}

TEST_CASE("Steps run in their order, and a colour step keeps the pixel's alpha straight") {
  // brightness(2) then grayscale(1): the first clamps at 1 before the second mixes it.
  auto p = render(row({{200, 0, 0, 255}}), ngn::appkit::layerFilters({brightness(2), grayscale()}), 0);
  CHECK(near(p.r, 0.2126));
  // The other order mixes first (0.2126 * 200 / 255), then doubles it.
  auto q = render(row({{200, 0, 0, 255}}), ngn::appkit::layerFilters({grayscale(), brightness(2)}), 0);
  CHECK(near(q.r, 2 * 0.2126 * 200 / 255));

  // Half transparent red, premultiplied: grayscale keeps its alpha and mixes its colour.
  auto half = render(row({{128, 0, 0, 128}}), ngn::appkit::layerFilters({grayscale()}), 0);
  CHECK(near(half.a, 128 / 255.0));
  CHECK(near(half.r, 0.2126, 0.03));
}

TEST_CASE("opacity scales the alpha of what the view draws") {
  auto p = render(row({{255, 0, 0, 255}}), ngn::appkit::layerFilters({opacity(0.5)}), 0);
  CHECK(near(p.a, 0.5));
  CHECK(near(p.r, 1, 0.03));
}

TEST_CASE("blur takes the standard deviation CSS gives, in points") {
  // 32 opaque pixels, then 32 clear ones, with the edge extended so the image's own border blurs nothing.
  std::vector<std::array<uint8_t, 4>> pixels;
  for (int i = 0; i < 64; i++) {
    pixels.push_back(i < 32 ? std::array<uint8_t, 4>{255, 255, 255, 255} : std::array<uint8_t, 4>{0, 0, 0, 0});
  }
  CIImage *image = [row(pixels) imageByClampingToExtent];
  auto filters = ngn::appkit::layerFilters({{.type = FilterStep::Type::Blur, .standardDeviation = 4}});
  // The centre of pixel 35 is 3.5 points past the edge: the Gaussian's tail is 1 - Phi(3.5 / 4).
  auto p = render(image, filters, 35);
  CHECK(near(p.a, 0.5 * std::erfc(3.5 / 4 / std::sqrt(2.0)), 0.03));
  // Well inside the opaque side nothing has changed.
  CHECK(near(render(image, filters, 10).a, 1, 0.01));
}

TEST_CASE("a drop shadow and an empty list draw no layer filter") {
  CHECK((ngn::appkit::layerFilters({}) == nil));
  CHECK((ngn::appkit::layerFilters({{.type = FilterStep::Type::DropShadow, .standardDeviation = 2, .offsetX = 1, .offsetY = 1}}) == nil));
  // A drop shadow among others is skipped and the others stay.
  auto filters = ngn::appkit::layerFilters({{.type = FilterStep::Type::DropShadow}, grayscale()});
  CHECK((filters != nil));
}

TEST_CASE("each mix-blend-mode but normal names the compositing filter React Native iOS gives it") {
  CHECK((ngn::appkit::blendFilterName(BlendMode::Normal) == nil));
  CHECK([ngn::appkit::blendFilterName(BlendMode::Multiply) isEqualToString:@"multiplyBlendMode"]);
  CHECK([ngn::appkit::blendFilterName(BlendMode::Screen) isEqualToString:@"screenBlendMode"]);
  CHECK([ngn::appkit::blendFilterName(BlendMode::ColorDodge) isEqualToString:@"colorDodgeBlendMode"]);
  CHECK([ngn::appkit::blendFilterName(BlendMode::Luminosity) isEqualToString:@"luminosityBlendMode"]);
  CHECK([ngn::appkit::blendFilterName(BlendMode::PlusLighter) isEqualToString:@"linearDodgeBlendMode"]);
}
