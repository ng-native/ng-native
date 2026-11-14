#include "ngn/text-recognition.h"

#include "ngn/file-system.h"

#include <algorithm>
#include <cctype>

#include <folly/json.h>

namespace ngn {

namespace {

std::string primary(const std::string &code) {
  std::string language = code.substr(0, code.find('-'));
  std::transform(language.begin(), language.end(), language.begin(), [](unsigned char c) { return std::tolower(c); });
  return language;
}

std::string joined(const std::vector<std::string> &values) {
  std::string out;
  for (const auto &value : values) {
    out += (out.empty() ? "" : ", ") + value;
  }
  return out;
}

folly::dynamic readingOf(const TextReader::Reading &reading) {
  folly::dynamic lines = folly::dynamic::array();
  std::string text;
  for (const auto &line : reading.lines) {
    text += (lines.empty() ? "" : "\n") + line.text;
    lines.push_back(folly::dynamic::object("text", line.text)("confidence", line.confidence)(
        "box",
        folly::dynamic::object("x", line.x * reading.width)("y", (1 - line.y - line.height) * reading.height)(
            "width", line.width * reading.width)("height", line.height * reading.height)));
  }
  return folly::dynamic::object("text", text)("lines", std::move(lines))("width", reading.width)("height", reading.height);
}

} // namespace

std::optional<std::string> visionLanguage(const std::string &code, const std::vector<std::string> &supported) {
  if (std::find(supported.begin(), supported.end(), code) != supported.end()) {
    return code;
  }
  auto wanted = primary(code);
  for (const auto &candidate : supported) {
    if (primary(candidate) == wanted) {
      return candidate;
    }
  }
  return std::nullopt;
}

std::shared_ptr<NativeModule> makeTextRecognitionModule(std::shared_ptr<TextReader> reader) {
  struct TextRecognition : NativeModule {
    explicit TextRecognition(std::shared_ptr<TextReader> reader) : NativeModule("NgNativeTextRecognition") {
      promise("recognize", [reader](const folly::dynamic &args, JsPromise promise) {
        std::string uri = !args.empty() && args[0].isString() ? args[0].asString() : "";
        auto path = pathOfUri(uri);
        if (!path) {
          promise.reject("No image could be read at " + uri);
          return;
        }
        const folly::dynamic options = args.size() > 1 && args[1].isObject() ? args[1] : folly::dynamic::object();
        const auto *level = options.get_ptr("level");
        bool fast = level != nullptr && level->isString() && level->asString() == "fast";
        std::vector<std::string> languages;
        const auto *given = options.get_ptr("languages");
        if (given != nullptr && given->isArray() && !given->empty()) {
          auto supported = reader->languages(fast);
          std::vector<std::string> unsupported;
          for (const auto &code : *given) {
            auto language = code.isString() ? visionLanguage(code.asString(), supported) : std::nullopt;
            if (language) {
              languages.push_back(*language);
            } else {
              unsupported.push_back(code.isString() ? code.asString() : folly::toJson(code));
            }
          }
          if (!unsupported.empty()) {
            promise.reject("Vision cannot read " + joined(unsupported) + " at this level. It can read " + joined(supported));
            return;
          }
        }
        reader->read(*path, languages, fast, [promise](std::optional<TextReader::Reading> reading, std::string error) {
          if (reading) {
            promise.resolve(readingOf(*reading));
          } else {
            promise.reject(error);
          }
        });
      });
    }
  };
  return std::make_shared<TextRecognition>(std::move(reader));
}

} // namespace ngn
