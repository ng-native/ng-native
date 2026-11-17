#include "fake-network.h"
#include "ngn/asset.h"
#include "ngn/file-system.h"

#include <doctest/doctest.h>

#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <optional>
#include <utility>
#include <vector>

using folly::dynamic;

namespace {

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-asset-" + std::to_string(getpid()) + "-" + std::to_string(rand()));
  Folder() {
    std::filesystem::create_directories(path);
  }
  ~Folder() {
    std::filesystem::remove_all(path);
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

std::shared_ptr<Answer> download(const ngn::NativeModule &module, dynamic args) {
  auto answer = std::make_shared<Answer>();
  module.callWithPromise(
      "downloadAsync", args,
      {.resolve = [answer](dynamic v) { answer->value = v; }, .reject = [answer](const std::string &e) { answer->error = e; }});
  return answer;
}

void serve(ngn::testing::FakeHttp &http, size_t index, const std::string &body, uint16_t status = 200) {
  REQUIRE(http.sent.size() > index);
  http.sent[index]->callbacks.onResponse({.status = status});
  http.sent[index]->callbacks.onData(body, -1);
  http.sent[index]->callbacks.onComplete("", false);
}

// File access whose only folder is the test's, as the caches.
std::shared_ptr<ngn::FileAccess> cachesOnly(const Folder &folder) {
  return std::make_shared<ngn::FileAccess>(ngn::FileAccess::Folders{.cache = folder.path.string()}, dynamic::array());
}

std::string contents(const std::string &uri) {
  std::ifstream in(uri.substr(7), std::ios::binary);
  return {std::istreambuf_iterator<char>(in), {}};
}

} // namespace

TEST_CASE("NgNativeAsset downloads an asset the dev server serves into the caches, by its hash, once") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeAssetModule(http, folder.path.string(), cachesOnly(folder));
  auto url = "http://localhost:8081/assets/hero.png?platform=macos&hash=abc123";
  auto first = download(*module, dynamic::array(url, "abc123", "png"));
  REQUIRE(http->sent.size() == 1);
  CHECK(http->sent[0]->request.url == url);
  serve(*http, 0, "png bytes");
  REQUIRE(first->value);
  CHECK(*first->value == dynamic(ngn::fileUri((folder.path / "ExponentAsset-abc123.png").string())));
  CHECK(contents(first->value->asString()) == "png bytes");
  // The same hash is the same file: it is not fetched again.
  auto again = download(*module, dynamic::array(url, "abc123", "png"));
  CHECK(*again->value == *first->value);
  CHECK(http->sent.size() == 1);
  // Without a hash, the url names the file, and it is fetched each time.
  auto unhashed = download(*module, dynamic::array("https://example.com/a/logo.svg", nullptr, nullptr));
  serve(*http, 1, "svg");
  auto name = std::filesystem::path(unhashed->value->asString()).filename().string();
  CHECK(name.rfind("ExponentAsset-", 0) == 0);
  CHECK(std::filesystem::path(name).extension() == ".svg");
  download(*module, dynamic::array("https://example.com/a/logo.svg", nullptr, nullptr));
  CHECK(http->sent.size() == 3);
}

TEST_CASE("NgNativeAsset answers a packaged app's asset file as it is, and rejects one that is not there") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeAssetModule(http, folder.path.string(), cachesOnly(folder));
  auto file = folder.path / "hero@2x.png";
  std::ofstream(file) << "x";
  auto uri = ngn::fileUri(file.string());
  CHECK(uri.find("hero%402x.png") != std::string::npos);
  CHECK(*download(*module, dynamic::array(uri, "h", "png"))->value == dynamic(uri));
  CHECK(*download(*module, dynamic::array(file.string(), nullptr, nullptr))->value == dynamic(uri));
  auto missing = download(*module, dynamic::array(ngn::fileUri((folder.path / "gone.png").string()), "h", "png"));
  CHECK(*missing->error == "Asset: there is no file at " + (folder.path / "gone.png").string());
  CHECK(http->sent.empty());
}

TEST_CASE("NgNativeAsset rejects a download that fails, and a uri it cannot read") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeAssetModule(http, folder.path.string(), cachesOnly(folder));
  auto missing = download(*module, dynamic::array("http://localhost:8081/assets/gone.png", "gone", "png"));
  serve(*http, 0, "", 404);
  CHECK(*missing->error == "Asset: http://localhost:8081/assets/gone.png could not be downloaded: HTTP 404");
  CHECK_FALSE(std::filesystem::exists(folder.path / "ExponentAsset-gone.png"));
  auto data = download(*module, dynamic::array("data:image/png;base64,AA", nullptr, nullptr));
  CHECK(*data->error == "Asset: data:image/png;base64,AA is not a file or an http(s) url");
  CHECK(*download(*module, dynamic::array())->error == "Asset.downloadAsync: takes the asset's uri");
}

TEST_CASE("NgNativeAsset answers a file only inside the file boundary, saying nothing of one outside") {
  Folder folder;
  Folder outside;
  Folder bundle;
  std::ofstream(outside.path / "secret.db") << "x";
  std::ofstream(bundle.path / "logo.png") << "x";
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeAssetModule(
      http, folder.path.string(),
      std::make_shared<ngn::FileAccess>(ngn::FileAccess::Folders{.cache = folder.path.string(), .bundle = bundle.path.string()}, dynamic::array()));

  // A packaged app's asset in its bundle is answered.
  auto logo = ngn::fileUri((bundle.path / "logo.png").string());
  CHECK(*download(*module, dynamic::array(logo, "h", "png"))->value == dynamic(logo));
  // A file outside is refused in the same words as a path outside with nothing there.
  auto there = download(*module, dynamic::array(ngn::fileUri((outside.path / "secret.db").string()), nullptr, nullptr));
  auto none = download(*module, dynamic::array(ngn::fileUri((outside.path / "none.db").string()), nullptr, nullptr));
  REQUIRE(there->error);
  REQUIRE(none->error);
  CHECK(there->error->find("outside the files this app may read") != std::string::npos);
  CHECK(there->error->substr(there->error->find(" is outside")) == none->error->substr(none->error->find(" is outside")));
  CHECK_FALSE(there->value);
  // Without file access every file is refused.
  auto closed = ngn::makeAssetModule(http, folder.path.string(), nullptr);
  CHECK(download(*closed, dynamic::array(logo, "h", "png"))->error);
}

TEST_CASE("NgNativeAsset refuses a hash or type that would name a file outside the caches") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto module = ngn::makeAssetModule(http, folder.path.string(), cachesOnly(folder));
  auto url = "http://localhost:8081/assets/hero.png";
  for (const auto &[hash, type] : std::vector<std::pair<std::string, std::string>>{
           {"/../../escaped", "png"}, {"abc/def", "png"}, {"abc", "png/../../escaped"}, {"..", "png"}}) {
    CAPTURE(hash);
    CAPTURE(type);
    CHECK(download(*module, dynamic::array(url, hash, type))->error);
  }
  CHECK(http->sent.empty());
  // A hash and type of letters, digits, '_' and '-' still download.
  download(*module, dynamic::array(url, "a1_b-2", "png"));
  CHECK(http->sent.size() == 1);
}
