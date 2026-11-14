#include "expo-image-drawing.h"

#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <react/renderer/graphics/Color.h>

namespace ngn::appkit {

DecodedImage::DecodedImage(DecodedImage &&other) noexcept
    : image(other.image), mediaType(std::move(other.mediaType)), animated(other.animated) {
  other.image = nullptr;
}

DecodedImage &DecodedImage::operator=(DecodedImage &&other) noexcept {
  if (this != &other) {
    CGImageRelease(image);
    image = other.image;
    other.image = nullptr;
    mediaType = std::move(other.mediaType);
    animated = other.animated;
  }
  return *this;
}

DecodedImage::~DecodedImage() {
  CGImageRelease(image);
}

std::optional<DecodedImage> decodeImage(const std::string &bytes) {
  NSData *data = [NSData dataWithBytes:bytes.data() length:bytes.size()];
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr);
  if (source == nullptr) {
    return std::nullopt;
  }
  NSDictionary *options = @{
    (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
    (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize : @(16384),
  };
  DecodedImage decoded;
  decoded.image = CGImageSourceGetCount(source) > 0
      ? CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options)
      : nullptr;
  decoded.animated = CGImageSourceGetCount(source) > 1;
  if (CFStringRef type = CGImageSourceGetType(source)) {
    UTType *uti = [UTType typeWithIdentifier:(__bridge NSString *)type];
    NSString *mime = uti.preferredMIMEType;
    decoded.mediaType = mime != nil ? mime.UTF8String : "";
  }
  CFRelease(source);
  if (decoded.image == nullptr) {
    return std::nullopt;
  }
  return decoded;
}

CGImageRef imageOfPixels(const DecodedPixels &pixels) {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CFDataRef data = CFDataCreate(nullptr, pixels.rgba.data(), static_cast<CFIndex>(pixels.rgba.size()));
  CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
  CGImageRef image = CGImageCreate(
      static_cast<size_t>(pixels.width), static_cast<size_t>(pixels.height), 8, 32, static_cast<size_t>(pixels.width) * 4, space,
      static_cast<CGBitmapInfo>(kCGImageAlphaLast), provider, nullptr, true, kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CFRelease(data);
  CGColorSpaceRelease(space);
  return image;
}

namespace {

// `image` blurred by `radius` pixels, its edges clamped so they do not fade. The caller releases it.
CGImageRef blurred(CGImageRef image, double radius) {
  CIImage *input = [[CIImage imageWithCGImage:image] imageByClampingToExtent];
  CIFilter *blur = [CIFilter filterWithName:@"CIGaussianBlur"];
  [blur setValue:input forKey:kCIInputImageKey];
  [blur setValue:@(radius) forKey:kCIInputRadiusKey];
  CGRect extent = CGRectMake(0, 0, CGImageGetWidth(image), CGImageGetHeight(image));
  CIContext *context = [CIContext contextWithOptions:nil];
  return [context createCGImage:blur.outputImage fromRect:extent];
}

} // namespace

void drawImage(
    CGContextRef context,
    CGImageRef image,
    const std::string &contentFit,
    const folly::dynamic &contentPosition,
    CGSize box,
    const facebook::react::SharedColor &tint,
    double blurRadius) {
  if (image == nullptr || box.width <= 0 || box.height <= 0) {
    return;
  }
  double width = CGImageGetWidth(image), height = CGImageGetHeight(image);
  auto rect = placeImage(contentFit, contentPosition, {width, height}, {box.width, box.height});
  CGImageRef drawn = image;
  if (blurRadius > 0) {
    // The radius is in points of the view; the image's pixels are scaled to the rectangle.
    double scale = rect.width > 0 ? width / rect.width : 1;
    if (CGImageRef made = blurred(image, blurRadius * scale)) {
      drawn = made;
    }
  }
  CGContextSaveGState(context);
  CGContextClipToRect(context, CGRectMake(0, 0, box.width, box.height));
  // Core Graphics draws an image upright in y-up space; the view's space is y-down.
  CGContextTranslateCTM(context, rect.x, rect.y + rect.height);
  CGContextScaleCTM(context, 1, -1);
  CGRect target = CGRectMake(0, 0, rect.width, rect.height);
  CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
  if (tint) {
    // The image's alpha as a mask, filled with the tint, as UIKit's template rendering does.
    CGContextClipToMask(context, target, drawn);
    auto c = facebook::react::colorComponentsFromColor(tint);
    CGContextSetRGBFillColor(context, c.red, c.green, c.blue, c.alpha);
    CGContextFillRect(context, target);
  } else {
    CGContextDrawImage(context, target, drawn);
  }
  CGContextRestoreGState(context);
  if (drawn != image) {
    CGImageRelease(drawn);
  }
}

} // namespace ngn::appkit
