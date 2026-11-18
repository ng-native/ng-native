#import "image-request.h"

using facebook::react::ImageSource;

namespace ngn::appkit {

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
