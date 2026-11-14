#include "ngn/text-recognition.h"

#include <doctest/doctest.h>

#include <optional>

using folly::dynamic;

namespace {

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, dynamic args) {
  Answer answer;
  module.callWithPromise(
      "recognize", args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

struct FakeReader final : ngn::TextReader {
  struct Asked {
    std::string path;
    std::vector<std::string> languages;
    bool fast;
  };
  std::vector<Asked> asked;
  std::optional<Reading> reading;
  std::vector<std::string> languages(bool fast) override {
    return fast ? std::vector<std::string>{"en-US"} : std::vector<std::string>{"en-US", "fr-FR", "zh-Hans"};
  }
  void read(const std::string &path, const std::vector<std::string> &languages, bool fast,
            std::function<void(std::optional<Reading>, std::string)> done) override {
    asked.push_back({path, languages, fast});
    done(reading, reading ? "" : "No image could be read at " + path);
  }
};

} // namespace

TEST_CASE("NgNativeTextRecognition answers the lines, their boxes in pixels from the top left") {
  auto reader = std::make_shared<FakeReader>();
  reader->reading = ngn::TextReader::Reading{
      .lines = {{.text = "Hello", .confidence = 1, .x = 0.1, .y = 0.75, .width = 0.5, .height = 0.25},
                {.text = "World", .confidence = 0.5, .x = 0, .y = 0, .width = 1, .height = 0.5}},
      .width = 200,
      .height = 100,
  };
  auto module = ngn::makeTextRecognitionModule(reader);
  auto answer = ask(*module, dynamic::array("file:///tmp/a%20b.png", dynamic::object()));
  REQUIRE(answer.value);
  CHECK((*answer.value)["text"] == dynamic("Hello\nWorld"));
  CHECK((*answer.value)["width"] == dynamic(200.0));
  CHECK((*answer.value)["lines"][0] ==
        dynamic(dynamic::object("text", "Hello")("confidence", 1.0)(
            "box", dynamic::object("x", 20.0)("y", 0.0)("width", 100.0)("height", 25.0))));
  CHECK((*answer.value)["lines"][1]["box"]["y"] == dynamic(50.0));
  REQUIRE(reader->asked.size() == 1);
  CHECK(reader->asked[0].path == "/tmp/a b.png");
  CHECK(reader->asked[0].languages.empty());
  CHECK_FALSE(reader->asked[0].fast);
}

TEST_CASE("NgNativeTextRecognition reads a language by its primary one, and refuses one Vision cannot read") {
  CHECK(ngn::visionLanguage("en-GB", {"en-US", "fr-FR"}) == "en-US");
  CHECK(ngn::visionLanguage("FR", {"en-US", "fr-FR"}) == "fr-FR");
  CHECK(ngn::visionLanguage("zh-Hant", {"zh-Hans", "zh-Hant"}) == "zh-Hant");
  CHECK_FALSE(ngn::visionLanguage("de-DE", {"en-US"}));

  auto reader = std::make_shared<FakeReader>();
  reader->reading = ngn::TextReader::Reading{};
  auto module = ngn::makeTextRecognitionModule(reader);
  CHECK(ask(*module, dynamic::array("/a.png", dynamic::object("languages", dynamic::array("en-GB", "fr"))("level", "accurate"))).value);
  CHECK(reader->asked.back().languages == std::vector<std::string>{"en-US", "fr-FR"});
  auto refused = ask(*module, dynamic::array("/a.png", dynamic::object("languages", dynamic::array("fr"))("level", "fast")));
  REQUIRE(refused.error);
  CHECK(*refused.error == "Vision cannot read fr at this level. It can read en-US");
  CHECK(reader->asked.size() == 1);
}

TEST_CASE("NgNativeTextRecognition refuses a uri that is not a file, and passes on a read that fails") {
  auto reader = std::make_shared<FakeReader>();
  auto module = ngn::makeTextRecognitionModule(reader);
  CHECK(ask(*module, dynamic::array("https://example.com/a.png", dynamic::object())).error);
  CHECK(ask(*module, dynamic::array("relative.png")).error);
  CHECK(reader->asked.empty());
  auto failed = ask(*module, dynamic::array("/missing.png"));
  CHECK(failed.error == std::string("No image could be read at /missing.png"));
}
