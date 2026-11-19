// Which source an Image loads (image-source.h).
#include "ngn/image-source.h"

#include <doctest/doctest.h>

using facebook::react::ImageSource;

TEST_CASE("An Image picks the source nearest the screen's scale, and loads again for new headers on the same uri") {
  ImageSource one{.uri = "a@1x.png", .scale = 1}, two{.uri = "a@2x.png", .scale = 2}, none{.scale = 2};
  CHECK(ngn::pickImageSource({one, two, none}, 2)->uri == "a@2x.png");
  CHECK(ngn::pickImageSource({one, two}, 1)->uri == "a@1x.png");
  CHECK_FALSE(ngn::pickImageSource({none}, 2));

  ImageSource signedIn = one;
  signedIn.headers = {{"Authorization", "Bearer a"}};
  CHECK(ngn::sameImageRequest(one, one));
  CHECK_FALSE(ngn::sameImageRequest(one, signedIn));
  ImageSource other = signedIn;
  other.headers = {{"Authorization", "Bearer b"}};
  CHECK_FALSE(ngn::sameImageRequest(signedIn, other));
}

TEST_CASE("A new cache policy, method, body or uri is a new request") {
  using Cache = ImageSource::CacheStategy;
  ImageSource plain{.uri = "a.png"};
  CHECK_FALSE(ngn::sameImageRequest(plain, ImageSource{.uri = "a.png", .cache = Cache::OnlyIfCached}));
  CHECK_FALSE(ngn::sameImageRequest(plain, ImageSource{.uri = "a.png", .method = "POST"}));
  CHECK_FALSE(ngn::sameImageRequest(plain, ImageSource{.uri = "a.png", .body = "q=1"}));
  CHECK_FALSE(ngn::sameImageRequest(plain, ImageSource{.uri = "b.png"}));
}
