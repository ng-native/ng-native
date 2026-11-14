// NgNativeTextRecognition: @ng-native/expo's TextRecognition, the same module the iOS app has, over
// a TextReader, which the AppKit backend implements with Vision's VNRecognizeTextRequest.
//
// - recognize(uri, {languages, level}): {text, lines: [{text, confidence, box}], width, height}.
//   A box is in the image's pixels from its top left corner, the right way up. `uri` is a `file:`
//   uri or an absolute path. A language Vision does not list is matched by its primary language
//   (`en-GB` reads as `en-US`), and one with no match refuses the call, naming those it can read.
//   Without languages, Vision detects the language.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class TextReader {
 public:
  struct Line {
    std::string text;
    double confidence{0};
    // A fraction of the image from its bottom left corner, as Vision gives it.
    double x{0}, y{0}, width{0}, height{0};
  };
  struct Reading {
    std::vector<Line> lines;
    // The upright image's size in pixels.
    double width{0};
    double height{0};
  };
  virtual ~TextReader() = default;
  // The languages Vision reads at this level.
  virtual std::vector<std::string> languages(bool fast) = 0;
  // Reads the image at `path`, off the calling thread. Answers once, on any thread: the reading,
  // or why there is none.
  virtual void read(
      const std::string &path,
      const std::vector<std::string> &languages,
      bool fast,
      std::function<void(std::optional<Reading>, std::string error)> done) = 0;
};

// The code Vision lists for `code`: itself, or the first with its primary language.
std::optional<std::string> visionLanguage(const std::string &code, const std::vector<std::string> &supported);

std::shared_ptr<NativeModule> makeTextRecognitionModule(std::shared_ptr<TextReader> reader);

} // namespace ngn
