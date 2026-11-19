// The request an Image loads its source with (image-request.h).
#include "../image-request.h"

#include <doctest/doctest.h>

using facebook::react::ImageSource;

TEST_CASE("An Image's request carries its source's method, headers and body") {
  ImageSource source{.uri = "https://example.com/a.png", .body = "q=1", .method = "POST"};
  source.headers = {{"Authorization", "Bearer token"}, {"X-Size", "large"}};
  NSURLRequest *request = ngn::appkit::imageRequest([NSURL URLWithString:@"https://example.com/a.png"], source);
  CHECK([request.HTTPMethod isEqualToString:@"POST"]);
  CHECK([[request valueForHTTPHeaderField:@"Authorization"] isEqualToString:@"Bearer token"]);
  CHECK([[request valueForHTTPHeaderField:@"X-Size"] isEqualToString:@"large"]);
  CHECK([request.HTTPBody isEqualToData:[@"q=1" dataUsingEncoding:NSUTF8StringEncoding]]);

  ImageSource plain{.uri = "https://example.com/a.png"};
  NSURLRequest *get = ngn::appkit::imageRequest([NSURL URLWithString:@"https://example.com/a.png"], plain);
  CHECK([get.HTTPMethod isEqualToString:@"GET"]);
  CHECK((get.HTTPBody == nil));
}

TEST_CASE("An Image's request keeps its source's cache policy") {
  using Cache = ImageSource::CacheStategy;
  auto policy = [](Cache cache) {
    ImageSource source{.uri = "https://example.com/a.png", .cache = cache};
    return ngn::appkit::imageRequest([NSURL URLWithString:@"https://example.com/a.png"], source).cachePolicy;
  };
  CHECK(policy(Cache::Default) == NSURLRequestUseProtocolCachePolicy);
  CHECK(policy(Cache::Reload) == NSURLRequestReloadIgnoringLocalCacheData);
  CHECK(policy(Cache::ForceCache) == NSURLRequestReturnCacheDataElseLoad);
  CHECK(policy(Cache::OnlyIfCached) == NSURLRequestReturnCacheDataDontLoad);
}
