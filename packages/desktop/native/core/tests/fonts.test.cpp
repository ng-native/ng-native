#include "fake-network.h"
#include "helpers.h"
#include "ngn/fonts.h"

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <optional>

using folly::dynamic;

namespace {

struct Answer {
  bool done{false};
  std::optional<std::string> error;
};

Answer load(const ngn::NativeModule &module, const std::string &name, const std::string &uri) {
  Answer answer;
  module.callWithPromise(
      "loadAsync", dynamic::array(name, uri),
      {.resolve = [&](dynamic) { answer.done = true; },
       .reject =
           [&](const std::string &e) {
             answer.done = true;
             answer.error = e;
           }});
  return answer;
}

// Registers any file whose contents start with "font:", as the family named after the colon.
struct FakeRegistrar final : ngn::FontRegistrar {
  std::vector<std::string> registered;
  ngn::RegisteredFont registerFile(const std::string &path) override {
    std::ifstream in(path, std::ios::binary);
    std::string contents((std::istreambuf_iterator<char>(in)), {});
    if (contents.rfind("font:", 0) != 0) {
      throw std::runtime_error("not a font");
    }
    registered.push_back(path);
    auto family = contents.substr(5);
    return {.family = family, .postScriptName = family + "-Regular"};
  }
};

struct Folder {
  std::filesystem::path path = std::filesystem::temp_directory_path() / ("ngn-fonts-" + std::to_string(rand()));
  Folder() {
    std::filesystem::create_directories(path);
  }
  ~Folder() {
    std::filesystem::remove_all(path);
  }
  std::string write(const std::string &name, const std::string &contents) const {
    std::ofstream(path / name, std::ios::binary) << contents;
    return (path / name).string();
  }
};

} // namespace

TEST_CASE("NgNativeFont registers a file and makes its name stand for the font's family") {
  Folder folder;
  auto registrar = std::make_shared<FakeRegistrar>();
  auto library = std::make_shared<ngn::FontLibrary>();
  auto module = ngn::makeFontModule(registrar, library, nullptr, folder.path.string(), ngn::testing::readsEverywhere());
  auto file = folder.write("inter.ttf", "font:Inter");
  CHECK(module->call("isLoaded", dynamic::array("Inter-700")) == dynamic(false));
  auto answer = load(*module, "Inter-700", "file://" + file);
  CHECK(answer.done);
  CHECK_FALSE(answer.error);
  CHECK(registrar->registered == std::vector<std::string>{file});
  CHECK(module->call("isLoaded", dynamic::array("Inter-700")) == dynamic(true));
  CHECK(library->fontOf("Inter-700")->family == "Inter");
  CHECK(library->fontOf("Inter-700")->postScriptName == "Inter-Regular");
  // A plain path, as well as a file: uri.
  CHECK_FALSE(load(*module, "Inter", file).error);
  CHECK(module->call("getLoadedFonts") == dynamic::array("Inter-700", "Inter"));
  CHECK_FALSE(library->fontOf("Roboto"));
}

TEST_CASE("NgNativeFont refuses what it cannot register, and loads nothing under the name") {
  Folder folder;
  auto library = std::make_shared<ngn::FontLibrary>();
  auto module = ngn::makeFontModule(std::make_shared<FakeRegistrar>(), library, nullptr, folder.path.string(), ngn::testing::readsEverywhere());
  auto answer = load(*module, "Broken", "file://" + folder.write("broken.ttf", "png"));
  REQUIRE(answer.error);
  CHECK(answer.error->find("not a font") != std::string::npos);
  CHECK(load(*module, "Gone", "file:///nowhere/at/all.ttf").error);
  CHECK(load(*module, "Data", "data:font/ttf;base64,AAAA").error);
  CHECK(load(*module, "", "file:///a.ttf").error);
  CHECK(library->names().empty());
}

TEST_CASE("NgNativeFont downloads a font the dev server serves, then registers it") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto registrar = std::make_shared<FakeRegistrar>();
  auto module = ngn::makeFontModule(registrar, std::make_shared<ngn::FontLibrary>(), http, folder.path.string() + "/fonts", ngn::testing::readsEverywhere());
  auto answer = load(*module, "Inter", "http://localhost:8081/assets/Inter.ttf?platform=macos&hash=1");
  REQUIRE(http->sent.size() == 1);
  CHECK(http->sent[0]->request.url == "http://localhost:8081/assets/Inter.ttf?platform=macos&hash=1");
  CHECK_FALSE(answer.done);
  auto &callbacks = http->sent[0]->callbacks;
  callbacks.onResponse({.status = 200});
  callbacks.onData("font:", -1);
  callbacks.onData("Inter", -1);
  callbacks.onComplete("", false);
  CHECK(answer.done);
  CHECK_FALSE(answer.error);
  REQUIRE(registrar->registered.size() == 1);
  CHECK(registrar->registered[0].rfind(folder.path.string() + "/fonts/", 0) == 0);
  CHECK(std::filesystem::path(registrar->registered[0]).extension() == ".ttf");
  CHECK(module->call("isLoaded", dynamic::array("Inter")) == dynamic(true));
}

TEST_CASE("NgNativeFont refuses a download that fails") {
  Folder folder;
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  auto registrar = std::make_shared<FakeRegistrar>();
  auto module = ngn::makeFontModule(registrar, std::make_shared<ngn::FontLibrary>(), http, folder.path.string(), ngn::testing::readsEverywhere());
  auto missing = load(*module, "Missing", "https://example.com/missing.otf");
  http->sent[0]->callbacks.onResponse({.status = 404});
  http->sent[0]->callbacks.onComplete("", false);
  REQUIRE(missing.error);
  CHECK(missing.error->find("404") != std::string::npos);
  auto offline = load(*module, "Offline", "https://example.com/offline.otf");
  http->sent[1]->callbacks.onComplete("The Internet connection appears to be offline.", false);
  CHECK(offline.error);
  CHECK(registrar->registered.empty());
  CHECK(module->call("getLoadedFonts") == dynamic::array());
}

TEST_CASE("NgNativeFont registers only files FileSystem could read, and says nothing of what is elsewhere") {
  Folder folder;
  std::filesystem::create_directories(folder.path / "cache");
  std::filesystem::create_directories(folder.path / "home/Library/Fonts");
  ngn::FileAccess::Folders folders{.cache = (folder.path / "cache").string(), .home = (folder.path / "home").string()};
  auto registrar = std::make_shared<FakeRegistrar>();
  auto module = ngn::makeFontModule(
      registrar, std::make_shared<ngn::FontLibrary>(), nullptr, folders.cache + "/fonts", std::make_shared<ngn::FileAccess>(folders, dynamic::array()));
  auto there = folder.write("home/Library/Fonts/Secret.ttf", "font:Secret");
  auto present = load(*module, "Secret", ngn::fileUri(there));
  auto absent = load(*module, "Secret", ngn::fileUri((folder.path / "home/Library/Fonts/None.ttf").string()));
  auto notFont = load(*module, "Secret", ngn::fileUri(folder.write("home/Library/Fonts/note.txt", "png")));
  REQUIRE(present.error);
  REQUIRE(absent.error);
  REQUIRE(notFont.error);
  CHECK(present.error->find("is outside the files this app may read") != std::string::npos);
  // One answer whether the file is there, missing or not a font: no way to tell them apart.
  auto tail = [](const std::string &error) { return error.substr(error.find(" is outside")); };
  CHECK(tail(*present.error) == tail(*absent.error));
  CHECK(tail(*present.error) == tail(*notFont.error));
  CHECK(registrar->registered.empty());

  // The app's own files are registered.
  auto own = folder.write("cache/Own.ttf", "font:Own");
  CHECK_FALSE(load(*module, "Own", own).error);
  CHECK(registrar->registered == std::vector<std::string>{own});
}
