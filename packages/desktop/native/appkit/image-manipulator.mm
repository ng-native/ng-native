#include "image-manipulator.h"

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <cmath>
#include <stdexcept>

namespace ngn::appkit {

namespace {

// Owns a Core Foundation reference.
template <typename T>
struct Ref {
  T ref{nullptr};
  explicit Ref(T ref) : ref(ref) {}
  ~Ref() {
    if (ref) {
      CFRelease(ref);
    }
  }
  Ref(const Ref &) = delete;
  Ref &operator=(const Ref &) = delete;
  Ref(Ref &&other) noexcept : ref(other.ref) {
    other.ref = nullptr;
  }
  Ref &operator=(Ref &&other) noexcept {
    std::swap(ref, other.ref);
    return *this;
  }
  operator T() const {
    return ref;
  }
};

Ref<CGImageSourceRef> sourceOf(const std::string &bytes) {
  Ref<CFDataRef> data(CFDataCreate(nullptr, reinterpret_cast<const UInt8 *>(bytes.data()), static_cast<CFIndex>(bytes.size())));
  return Ref<CGImageSourceRef>(CGImageSourceCreateWithData(data, nullptr));
}

// The stored size, and whether the orientation turns it a quarter.
std::optional<ImageSize> storedSize(CGImageSourceRef source, bool &quarterTurn) {
  if (!source || CGImageSourceGetCount(source) == 0) {
    return std::nullopt;
  }
  NSDictionary *properties = (__bridge_transfer NSDictionary *)CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr);
  NSNumber *width = properties[(__bridge NSString *)kCGImagePropertyPixelWidth];
  NSNumber *height = properties[(__bridge NSString *)kCGImagePropertyPixelHeight];
  if (!width || !height) {
    return std::nullopt;
  }
  int orientation = [properties[(__bridge NSString *)kCGImagePropertyOrientation] intValue];
  quarterTurn = orientation >= 5 && orientation <= 8;
  return ImageSize{width.intValue, height.intValue};
}

Ref<CGImageRef> uprightImage(CGImageSourceRef source) {
  bool quarterTurn = false;
  auto size = storedSize(source, quarterTurn);
  if (!size) {
    throw std::runtime_error("Image cannot be found");
  }
  // A thumbnail as large as the image, with the orientation applied: the image the right way up.
  NSDictionary *options = @{
    (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
    (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize : @(std::max(size->width, size->height)),
    (__bridge NSString *)kCGImageSourceShouldCacheImmediately : @YES,
  };
  Ref<CGImageRef> image(CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options));
  if (!image) {
    throw std::runtime_error("Image cannot be found");
  }
  return image;
}

// A bitmap of `size` that `draw` paints, as an image. Core Graphics' origin is the bottom left.
template <typename Draw>
Ref<CGImageRef> drawn(ImageSize size, Draw draw) {
  Ref<CGColorSpaceRef> space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB));
  Ref<CGContextRef> context(CGBitmapContextCreate(
      nullptr, size.width, size.height, 8, 0, space, kCGImageAlphaPremultipliedLast));
  if (!context) {
    throw std::runtime_error("Could not read the image from the drawing context");
  }
  CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
  draw(static_cast<CGContextRef>(context));
  Ref<CGImageRef> image(CGBitmapContextCreateImage(context));
  if (!image) {
    throw std::runtime_error("Could not read the image from the drawing context");
  }
  return image;
}

Ref<CGImageRef> apply(CGImageRef image, const ImageStep &step) {
  double width = CGImageGetWidth(image), height = CGImageGetHeight(image);
  double outWidth = step.size.width, outHeight = step.size.height;
  switch (step.kind) {
    case ImageStep::Kind::Crop: {
      Ref<CGImageRef> cropped(CGImageCreateWithImageInRect(image, CGRectMake(step.x, step.y, outWidth, outHeight)));
      if (!cropped) {
        throw std::runtime_error("Cropping the image has failed");
      }
      return cropped;
    }
    case ImageStep::Kind::Resize:
      return drawn(step.size, [&](CGContextRef c) { CGContextDrawImage(c, CGRectMake(0, 0, outWidth, outHeight), image); });
    case ImageStep::Kind::FlipHorizontal:
      return drawn(step.size, [&](CGContextRef c) {
        CGContextTranslateCTM(c, outWidth, 0);
        CGContextScaleCTM(c, -1, 1);
        CGContextDrawImage(c, CGRectMake(0, 0, width, height), image);
      });
    case ImageStep::Kind::FlipVertical:
      return drawn(step.size, [&](CGContextRef c) {
        CGContextTranslateCTM(c, 0, outHeight);
        CGContextScaleCTM(c, 1, -1);
        CGContextDrawImage(c, CGRectMake(0, 0, width, height), image);
      });
    case ImageStep::Kind::Rotate:
      return drawn(step.size, [&](CGContextRef c) {
        // Clockwise on screen is a negative angle with Core Graphics' upward y.
        CGContextTranslateCTM(c, outWidth / 2, outHeight / 2);
        CGContextRotateCTM(c, -step.degrees * M_PI / 180);
        CGContextDrawImage(c, CGRectMake(-width / 2, -height / 2, width, height), image);
      });
  }
  return Ref<CGImageRef>(CGImageRetain(image));
}

NSString *typeOf(const std::string &format) {
  if (format == "png") {
    return UTTypePNG.identifier;
  }
  if (format == "webp") {
    return UTTypeWebP.identifier;
  }
  return UTTypeJPEG.identifier;
}

class ImageIOCodec final : public ImageCodec {
 public:
  std::optional<ImageSize> size(const std::string &bytes) override {
    @autoreleasepool {
      auto source = sourceOf(bytes);
      bool quarterTurn = false;
      auto stored = storedSize(source, quarterTurn);
      if (stored && quarterTurn) {
        std::swap(stored->width, stored->height);
      }
      return stored;
    }
  }

  bool encodes(const std::string &format) override {
    NSArray *types = (__bridge_transfer NSArray *)CGImageDestinationCopyTypeIdentifiers();
    return [types containsObject:typeOf(format)];
  }

  std::string render(const std::string &bytes, const std::vector<ImageStep> &steps, const std::string &format, double quality) override {
    @autoreleasepool {
      auto source = sourceOf(bytes);
      auto image = uprightImage(source);
      for (const auto &step : steps) {
        image = apply(image, step);
      }
      NSMutableData *data = [NSMutableData data];
      Ref<CGImageDestinationRef> destination(
          CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, (__bridge CFStringRef)typeOf(format), 1, nullptr));
      if (!destination) {
        throw std::runtime_error("Cannot create image data for given image format");
      }
      NSDictionary *properties = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality : @(quality)};
      CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
      if (!CGImageDestinationFinalize(destination)) {
        throw std::runtime_error("Cannot create image data for given image format");
      }
      return std::string(static_cast<const char *>(data.bytes), data.length);
    }
  }
};

} // namespace

std::shared_ptr<ImageCodec> makeImageCodec() {
  return std::make_shared<ImageIOCodec>();
}

} // namespace ngn::appkit
