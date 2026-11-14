// `<expo-image>`'s decoding and drawing on macOS (the core's expo-image.h), apart from its view so
// they run into a bitmap with no window: ImageIO decodes the bytes, and Core Graphics draws the
// image where `placeImage` puts it, tinted and blurred as the props ask.
#pragma once

#include "ngn/expo-image.h"

#import <AppKit/AppKit.h>

#include <optional>
#include <string>

namespace ngn::appkit {

struct DecodedImage {
  CGImageRef image{nullptr};
  // expo-image's media type, as `image/png`.
  std::string mediaType;
  bool animated{false};
  DecodedImage() = default;
  DecodedImage(const DecodedImage &) = delete;
  DecodedImage(DecodedImage &&other) noexcept;
  DecodedImage &operator=(DecodedImage &&other) noexcept;
  ~DecodedImage();
};

// The first frame of the encoded image, upright by its orientation, or nothing for bytes that
// are not an image.
std::optional<DecodedImage> decodeImage(const std::string &bytes);

// Pixels the core decoded (a blurhash or a thumbhash) as an image. The caller releases it.
CGImageRef imageOfPixels(const DecodedPixels &pixels);

// Draws `image` into `context`, whose origin is the box's top left with y going down, as a view
// draws: placed by `contentFit` and `contentPosition`, clipped to the box, with every opaque
// pixel in `tint` when one is set, and blurred by `blurRadius` points.
void drawImage(
    CGContextRef context,
    CGImageRef image,
    const std::string &contentFit,
    const folly::dynamic &contentPosition,
    CGSize box,
    const facebook::react::SharedColor &tint,
    double blurRadius);

} // namespace ngn::appkit
