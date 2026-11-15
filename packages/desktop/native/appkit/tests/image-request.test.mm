// What an Image asks for (image-request.h).
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

TEST_CASE("An Image picks the source nearest the screen's scale, and loads again for new headers on the same uri") {
  ImageSource one{.uri = "a@1x.png", .scale = 1}, two{.uri = "a@2x.png", .scale = 2}, none{.scale = 2};
  CHECK(ngn::appkit::pickImageSource({one, two, none}, 2)->uri == "a@2x.png");
  CHECK(ngn::appkit::pickImageSource({one, two}, 1)->uri == "a@1x.png");
  CHECK_FALSE(ngn::appkit::pickImageSource({none}, 2));

  ImageSource signedIn = one;
  signedIn.headers = {{"Authorization", "Bearer a"}};
  CHECK(ngn::appkit::sameImageRequest(one, one));
  CHECK_FALSE(ngn::appkit::sameImageRequest(one, signedIn));
  ImageSource other = signedIn;
  other.headers = {{"Authorization", "Bearer b"}};
  CHECK_FALSE(ngn::appkit::sameImageRequest(signedIn, other));
}
