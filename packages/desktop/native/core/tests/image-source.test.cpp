// Which source an Image loads, how it reads it and where it draws it (image-source.h).
#include "fake-network.h"
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

TEST_CASE("An Image's resizeMode places its image as the macOS host's layer gravity does") {
  using Mode = facebook::react::ImageResizeMode;
  auto place = [](Mode mode) { return ngn::placeImage(ngn::imageContentFit(mode), nullptr, {200, 100}, {100, 100}); };
  CHECK(place(Mode::Cover) == ngn::ImageRect{-50, 0, 200, 100});
  CHECK(place(Mode::Contain) == ngn::ImageRect{0, 25, 100, 50});
  CHECK(place(Mode::Stretch) == ngn::ImageRect{0, 0, 100, 100});
  // At its own size, centred, however large.
  CHECK(place(Mode::Center) == ngn::ImageRect{-50, 0, 200, 100});
  CHECK(place(Mode::Repeat) == ngn::ImageRect{0, 0, 100, 100});
}

namespace {

void serve(ngn::testing::FakeHttp &http, size_t index, const std::string &body, uint16_t status = 200) {
  REQUIRE(http.sent.size() > index);
  auto &callbacks = http.sent[index]->callbacks;
  callbacks.onResponse({.status = status});
  callbacks.onData(body, -1);
  callbacks.onComplete("", false);
}

struct Answers {
  std::vector<std::pair<std::string, std::string>> all;
  std::function<void(std::string, const std::string &)> record() {
    return [this](std::string bytes, const std::string &error) { all.emplace_back(std::move(bytes), error); };
  }
};

using Answer = std::pair<std::string, std::string>;

} // namespace

TEST_CASE("loadImageSource sends the source's method, headers and body, and keeps what a GET fetched") {
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto cache = std::make_shared<ngn::ImageCache>("", 1 << 20);
  Answers answers;
  ImageSource source{.uri = "https://example.com/a.png", .headers = {{"Authorization", "Bearer x"}}};
  ngn::loadImageSource(http, cache, nullptr, source, answers.record());
  REQUIRE(http->sent.size() == 1);
  CHECK(http->sent[0]->request.method == "GET");
  CHECK(http->sent[0]->request.url == "https://example.com/a.png");
  CHECK(http->sent[0]->request.headers == ngn::Headers{{"Authorization", "Bearer x"}});
  serve(*http, 0, "PNG");
  REQUIRE(answers.all.size() == 1);
  CHECK(answers.all[0] == Answer{"PNG", ""});

  // The same source again comes from the cache, and so does force-cache and only-if-cached.
  ngn::loadImageSource(http, cache, nullptr, source, answers.record());
  source.cache = ImageSource::CacheStategy::ForceCache;
  ngn::loadImageSource(http, cache, nullptr, source, answers.record());
  source.cache = ImageSource::CacheStategy::OnlyIfCached;
  ngn::loadImageSource(http, cache, nullptr, source, answers.record());
  CHECK(http->sent.size() == 1);
  REQUIRE(answers.all.size() == 4);
  CHECK(answers.all[1] == Answer{"PNG", ""});
  CHECK(answers.all[3] == Answer{"PNG", ""});

  // reload fetches again, and what it fetched replaces what was kept.
  source.cache = ImageSource::CacheStategy::Reload;
  ngn::loadImageSource(http, cache, nullptr, source, answers.record());
  REQUIRE(http->sent.size() == 2);
  serve(*http, 1, "PNG2");
  source.cache = ImageSource::CacheStategy::Default;
  ngn::loadImageSource(http, cache, nullptr, source, answers.record());
  CHECK(http->sent.size() == 2);
  CHECK(answers.all.back() == Answer{"PNG2", ""});

  // A POST is sent with its body, and never kept.
  ImageSource post{.uri = "https://example.com/b.png", .body = "q=1", .method = "POST"};
  ngn::loadImageSource(http, cache, nullptr, post, answers.record());
  REQUIRE(http->sent.size() == 3);
  CHECK(http->sent[2]->request.method == "POST");
  CHECK(http->sent[2]->request.body == "q=1");
  serve(*http, 2, "B");
  ngn::loadImageSource(http, cache, nullptr, post, answers.record());
  CHECK(http->sent.size() == 4);
}

TEST_CASE("loadImageSource fails a source it cannot load, and one only-if-cached the cache does not hold") {
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto cache = std::make_shared<ngn::ImageCache>("", 1 << 20);
  Answers answers;
  ngn::loadImageSource(http, cache, nullptr, {.uri = "https://example.com/gone.png"}, answers.record());
  serve(*http, 0, "", 404);
  CHECK(answers.all.back() == Answer{"", "Could not load the image at https://example.com/gone.png (HTTP 404)"});
  // A failure is not kept.
  ngn::loadImageSource(http, cache, nullptr, {.uri = "https://example.com/gone.png"}, answers.record());
  CHECK(http->sent.size() == 2);

  ImageSource cachedOnly{.uri = "https://example.com/c.png", .cache = ImageSource::CacheStategy::OnlyIfCached};
  ngn::loadImageSource(http, cache, nullptr, cachedOnly, answers.record());
  CHECK(http->sent.size() == 2);
  CHECK(answers.all.back() == Answer{"", "The image at https://example.com/c.png is not in the cache"});

  ngn::loadImageSource(http, cache, nullptr, {.uri = "content://x"}, answers.record());
  CHECK(answers.all.back() == Answer{"", "Invalid image URL: content://x"});
  // A file with no file access is refused, unread.
  ngn::loadImageSource(http, cache, nullptr, {.uri = "/etc/hosts"}, answers.record());
  CHECK_FALSE(answers.all.back().second.empty());
  CHECK(http->sent.size() == 2);
  // A data uri is read through the client, and never kept.
  ngn::loadImageSource(http, cache, nullptr, {.uri = "data:image/png;base64,AAAA"}, answers.record());
  REQUIRE(http->sent.size() == 3);
  CHECK(http->sent[2]->request.url == "data:image/png;base64,AAAA");
  serve(*http, 2, "D");
  ngn::loadImageSource(http, cache, nullptr, {.uri = "data:image/png;base64,AAAA"}, answers.record());
  CHECK(http->sent.size() == 4);
}
