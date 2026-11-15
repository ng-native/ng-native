#import "image-request.h"

#include <cmath>

using facebook::react::ImageSource;

namespace ngn::appkit {

std::optional<ImageSource> pickImageSource(const std::vector<ImageSource> &sources, double screenScale) {
  std::optional<ImageSource> best;
  double distance = INFINITY;
  for (const auto &source : sources) {
    if (source.uri.empty()) {
      continue;
    }
    double d = std::abs(source.scale - screenScale);
    if (d < distance) {
      distance = d;
      best = source;
    }
  }
  return best;
}

bool sameImageRequest(const ImageSource &a, const ImageSource &b) {
  return a.uri == b.uri && a.cache == b.cache && a.method == b.method && a.headers == b.headers && a.body == b.body;
}

NSURLRequest *imageRequest(NSURL *url, const ImageSource &source) {
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  // As React Native iOS maps a source's `cache` (RCTImagePrimitivesConversions.h).
  switch (source.cache) {
    case ImageSource::CacheStategy::Default:
      request.cachePolicy = NSURLRequestUseProtocolCachePolicy;
      break;
    case ImageSource::CacheStategy::Reload:
      request.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
      break;
    case ImageSource::CacheStategy::ForceCache:
      request.cachePolicy = NSURLRequestReturnCacheDataElseLoad;
      break;
    case ImageSource::CacheStategy::OnlyIfCached:
      request.cachePolicy = NSURLRequestReturnCacheDataDontLoad;
      break;
  }
  if (!source.method.empty()) {
    request.HTTPMethod = [NSString stringWithUTF8String:source.method.c_str()];
  }
  for (const auto &[name, value] : source.headers) {
    NSString *field = [NSString stringWithUTF8String:name.c_str()];
    NSString *text = [NSString stringWithUTF8String:value.c_str()];
    if (field != nil && text != nil) {
      [request setValue:text forHTTPHeaderField:field];
    }
  }
  if (!source.body.empty()) {
    request.HTTPBody = [NSData dataWithBytes:source.body.data() length:source.body.size()];
  }
  return request;
}

} // namespace ngn::appkit
