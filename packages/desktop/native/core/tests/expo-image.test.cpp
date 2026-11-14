#include "fake-network.h"
#include "ngn/bytes.h"
#include "ngn/expo-image.h"

#include <doctest/doctest.h>

#include <filesystem>

using folly::dynamic;
using ngn::ImageRect;

namespace {

std::string encode83(int value, int length) {
  static const std::string digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
  std::string out(static_cast<size_t>(length), '0');
  for (int i = length - 1; i >= 0; i--) {
    out[static_cast<size_t>(i)] = digits[static_cast<size_t>(value % 83)];
    value /= 83;
  }
  return out;
}

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-expo-image-" + std::to_string(rand()));
  ~Folder() {
    std::filesystem::remove_all(path);
  }
};

void serve(ngn::testing::FakeHttp &http, size_t index, const std::string &body, uint16_t status = 200) {
  REQUIRE(http.sent.size() > index);
  auto &callbacks = http.sent[index]->callbacks;
  callbacks.onResponse({.status = status});
  callbacks.onData(body, -1);
  callbacks.onComplete("", false);
}

} // namespace

TEST_CASE("imageSources reads expo-image's source list, and bestImageSource picks the nearest pixel count") {
  auto sources = ngn::imageSources(dynamic::array(
      dynamic::object("uri", "https://a/small.png")("width", 100)("height", 100),
      dynamic::object("uri", "https://a/large.png")("width", 400)("height", 400)("cacheKey", "large")(
          "headers", dynamic::object("Authorization", "Bearer x")),
      dynamic::object("width", 10)));
  REQUIRE(sources.size() == 2);
  CHECK(sources[1].cacheKey == "large");
  CHECK(sources[1].headers == std::vector<std::pair<std::string, std::string>>{{"Authorization", "Bearer x"}});
  CHECK(ngn::bestImageSource(sources, 100, 100, 1)->uri == "https://a/small.png");
  // At 2x a 200-point view wants 400 pixels a side.
  CHECK(ngn::bestImageSource(sources, 200, 200, 2)->uri == "https://a/large.png");
  CHECK_FALSE(ngn::bestImageSource(sources, 0, 100, 1));
  CHECK(ngn::imageSources(dynamic::object("uri", "file:///a.png")).size() == 1);
}

TEST_CASE("placeImage fits an image as CSS object-fit does, placed by contentPosition") {
  std::pair<double, double> image{200, 100}, box{100, 100};
  CHECK(ngn::placeImage("cover", nullptr, image, box) == ImageRect{-50, 0, 200, 100});
  CHECK(ngn::placeImage("contain", nullptr, image, box) == ImageRect{0, 25, 100, 50});
  CHECK(ngn::placeImage("fill", nullptr, image, box) == ImageRect{0, 0, 100, 100});
  CHECK(ngn::placeImage("none", nullptr, {50, 20}, box) == ImageRect{25, 40, 50, 20});
  // scale-down: contain for a larger image, its own size for a smaller one.
  CHECK(ngn::placeImage("scale-down", nullptr, image, box) == ImageRect{0, 25, 100, 50});
  CHECK(ngn::placeImage("scale-down", nullptr, {50, 20}, box) == ImageRect{25, 40, 50, 20});
  // Positions: points from an edge, or a percentage of the space left.
  CHECK(ngn::placeImage("cover", dynamic::object("left", 0), image, box) == ImageRect{0, 0, 200, 100});
  CHECK(ngn::placeImage("cover", dynamic::object("right", 10), image, box) == ImageRect{-110, 0, 200, 100});
  CHECK(ngn::placeImage("cover", dynamic::object("left", "25%"), image, box) == ImageRect{-25, 0, 200, 100});
  CHECK(ngn::placeImage("contain", dynamic::object("top", 0), image, box) == ImageRect{0, 0, 100, 50});
  CHECK(ngn::placeImage("contain", dynamic::object("bottom", "0%"), image, box) == ImageRect{0, 50, 100, 50});
}

TEST_CASE("imageTransition reads a duration or expo-image's transition object") {
  CHECK(ngn::imageTransition(300) == ngn::ImageTransition{.duration = 300});
  CHECK(ngn::imageTransition(dynamic::object("duration", 500)("effect", "flip-from-left")("timing", "linear")) ==
        ngn::ImageTransition{.duration = 500, .effect = "flip-from-left", .timing = "linear"});
  CHECK(ngn::imageTransition(nullptr).duration == 0);
}

TEST_CASE("decodeBlurhash decodes one colour exactly, and a hash's average to its DC colour") {
  auto red = ngn::decodeBlurhash("00" + encode83(0xFF2000, 4), 4, 3);
  REQUIRE(red);
  CHECK(red->width == 4);
  CHECK(red->height == 3);
  for (size_t i = 0; i < red->rgba.size(); i += 4) {
    CHECK(red->rgba[i] == 255);
    CHECK(red->rgba[i + 1] == 32);
    CHECK(red->rgba[i + 2] == 0);
    CHECK(red->rgba[i + 3] == 255);
  }
  // The blurhash project's own example.
  auto photo = ngn::decodeBlurhash("LEHV6nWB2yk8pyo0adR*.7kCMdnj", 32, 32);
  REQUIRE(photo);
  double sum[3] = {0, 0, 0};
  for (size_t i = 0; i < photo->rgba.size(); i += 4) {
    for (int c = 0; c < 3; c++) {
      sum[c] += photo->rgba[i + static_cast<size_t>(c)];
    }
  }
  // "HV6n" is its DC: rgb(151, 150, 149) in sRGB.
  CHECK(sum[0] / 1024 == doctest::Approx(151).epsilon(0.03));
  CHECK(sum[1] / 1024 == doctest::Approx(150).epsilon(0.03));
  CHECK(sum[2] / 1024 == doctest::Approx(149).epsilon(0.03));
  CHECK(photo->rgba[0] != photo->rgba[(31 * 32 + 31) * 4]);
  CHECK_FALSE(ngn::decodeBlurhash("LEHV6nWB2yk8", 32, 32));
  CHECK_FALSE(ngn::decodeBlurhash("00TI:\"", 4, 4));
}

TEST_CASE("decodeThumbhash decodes a flat hash to its colour at the size its header gives") {
  // L at 1, P and Q near 0, every AC scale 0: one near-white colour.
  int header24 = 63 | (32 << 6) | (31 << 12);
  int header16 = 7;
  std::string bytes{static_cast<char>(header24 & 255), static_cast<char>((header24 >> 8) & 255), static_cast<char>(header24 >> 16),
                    static_cast<char>(header16 & 255), static_cast<char>(header16 >> 8), 0, 0, 0, 0, 0, 0, 0};
  auto flat = ngn::decodeThumbhash(bytes);
  REQUIRE(flat);
  CHECK(flat->width == 32);
  CHECK(flat->height == 32);
  double p = 32 / 31.5 - 1, q = 31 / 31.5 - 1, l = 1;
  double b = l - 2.0 / 3 * p, r = (3 * l - b + q) / 2, g = r - q;
  auto channel = [](double v) { return static_cast<int>(std::max(0.0, 255 * std::min(1.0, v))); };
  for (size_t i = 0; i < flat->rgba.size(); i += 4) {
    CHECK(flat->rgba[i] == channel(r));
    CHECK(flat->rgba[i + 1] == channel(g));
    CHECK(flat->rgba[i + 2] == channel(b));
    CHECK(flat->rgba[i + 3] == 255);
  }
  // Landscape, three rows of luminance: 7 by 3, so 32 by 14.
  bytes[3] = 3;
  bytes[4] = static_cast<char>(0x80);
  auto wide = ngn::decodeThumbhash(bytes);
  REQUIRE(wide);
  CHECK(wide->width == 32);
  CHECK(wide->height == 14);
  CHECK_FALSE(ngn::decodeThumbhash("abc"));
}

TEST_CASE("decodeHashUri reads expo-image's blurhash and thumbhash uris") {
  auto blur = ngn::decodeHashUri("blurhash:/" + std::string("LEHV6nWB2yk8pyo0adR%2A.7kCMdnj"), 20, 10);
  REQUIRE(blur);
  CHECK(blur->width == 20);
  CHECK(blur->height == 10);
  CHECK(ngn::decodeHashUri("blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj")->width == 16);
  std::string thumb{static_cast<char>(63), 8, static_cast<char>(31 << 4), 7, 0, 0, 0, 0, 0, 0, 0, 0};
  auto encoded = ngn::base64Encode(thumb);
  std::replace(encoded.begin(), encoded.end(), '/', '\\');
  auto decoded = ngn::decodeHashUri("thumbhash:/" + encoded);
  REQUIRE(decoded);
  CHECK(decoded->width == 32);
  CHECK_FALSE(ngn::decodeHashUri("https://example.com/a.png"));
}

TEST_CASE("ImageCache keeps bytes in memory and on disk by policy, the least recently used memory dropped first") {
  Folder folder;
  ngn::ImageCache cache(folder.path.string(), 10);
  cache.store("a", "aaaa", "memory");
  CHECK(cache.find("a", "memory")->second == ngn::ImageCache::Hit::Memory);
  CHECK_FALSE(cache.find("a", "disk"));
  CHECK_FALSE(cache.find("a", "none"));
  cache.store("b", "bbbb", "memory-disk");
  CHECK(std::filesystem::exists(cache.diskPath("b")));
  cache.find("a", "memory");
  // Past 10 bytes, b (used less recently than a) goes from memory, and stays on disk.
  cache.store("c", "cccc", "memory");
  CHECK(cache.memoryBytes() == 8);
  CHECK(cache.find("a", "memory"));
  auto b = cache.find("b", "memory-disk");
  REQUIRE(b);
  CHECK(b->first == "bbbb");
  CHECK(b->second == ngn::ImageCache::Hit::Disk);
  // Read from disk under memory-disk, it is in memory again.
  CHECK(cache.find("b", "memory")->second == ngn::ImageCache::Hit::Memory);
  // An image larger than the whole memory is not kept there.
  cache.store("huge", std::string(20, 'h'), "memory");
  CHECK_FALSE(cache.find("huge", "memory"));
  cache.clearMemory();
  CHECK(cache.memoryBytes() == 0);
  CHECK(cache.find("b", "disk"));
  CHECK(cache.clearDisk());
  CHECK_FALSE(cache.find("b", "disk"));
}

TEST_CASE("loadImageBytes fetches with the source's headers once, then answers from the cache by its cache key") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto cache = std::make_shared<ngn::ImageCache>(folder.path.string(), 1 << 20);
  ngn::ImageSourceRef source{.uri = "https://example.com/a.png?token=1", .headers = {{"Authorization", "Bearer x"}}, .cacheKey = "a"};
  std::vector<std::tuple<std::string, ngn::ImageCache::Hit, std::string>> answers;
  auto record = [&](std::string bytes, ngn::ImageCache::Hit hit, const std::string &error) { answers.emplace_back(bytes, hit, error); };
  ngn::loadImageBytes(http, cache, source, "memory-disk", record);
  REQUIRE(http->sent.size() == 1);
  CHECK(http->sent[0]->request.headers == ngn::Headers{{"Authorization", "Bearer x"}});
  serve(*http, 0, "PNG");
  REQUIRE(answers.size() == 1);
  CHECK(answers[0] == std::tuple{std::string("PNG"), ngn::ImageCache::Hit::None, std::string()});
  // Another uri with the same cache key is the same image.
  source.uri = "https://example.com/a.png?token=2";
  ngn::loadImageBytes(http, cache, source, "memory-disk", record);
  CHECK(http->sent.size() == 1);
  CHECK(answers[1] == std::tuple{std::string("PNG"), ngn::ImageCache::Hit::Memory, std::string()});
  // With no cache policy it fetches again.
  ngn::loadImageBytes(http, cache, source, "none", record);
  CHECK(http->sent.size() == 2);
  serve(*http, 1, "", 404);
  CHECK(std::get<2>(answers[2]) == "HTTP 404");
  // A file is read, never cached.
  ngn::loadImageBytes(http, cache, {.uri = "/tmp/x.png"}, "memory-disk", record);
  CHECK(http->sent[2]->request.url == "file:///tmp/x.png");
  ngn::loadImageBytes(http, cache, {.uri = "content://x"}, "memory", record);
  CHECK(std::get<2>(answers.back()) == "content://x is not a file, data or http(s) uri");
}
