// CoreTextRegistrar (fonts.mm) and text layout's use of the names fonts load under (text-layout.mm),
// on a copy of a font macOS ships, outside the system's font folders.
#include "../fonts.h"
#include "../text-layout.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>

#include <filesystem>
#include <fstream>

namespace {

struct Copy {
  std::filesystem::path path;
  explicit Copy(const char *from, const char *name) {
    path = std::filesystem::temp_directory_path() / name;
    std::filesystem::copy_file(from, path, std::filesystem::copy_options::overwrite_existing);
  }
  ~Copy() {
    std::filesystem::remove(path);
  }
};

// The PostScript name of the font the text is set in.
std::string fontOf(const std::string &fontFamily, facebook::react::FontWeight weight = facebook::react::FontWeight::Regular) {
  facebook::react::AttributedString text;
  facebook::react::AttributedString::Fragment fragment;
  fragment.string = "Hello";
  fragment.textAttributes.fontFamily = fontFamily;
  fragment.textAttributes.fontSize = 14;
  fragment.textAttributes.fontWeight = weight;
  text.appendFragment(std::move(fragment));
  CFAttributedStringRef string = ngn::makeAttributedString(text);
  auto font = (__bridge NSFont *)CFAttributedStringGetAttribute(string, 0, kCTFontAttributeName, nullptr);
  std::string name = font.fontName.UTF8String;
  CFRelease(string);
  return name;
}

} // namespace

TEST_CASE("CoreTextRegistrar registers a font file and names its family, again and again") {
  Copy font("/System/Library/Fonts/Supplemental/Courier New.ttf", "ngn-test-font.ttf");
  auto registrar = ngn::appkit::makeFontRegistrar();
  auto registered = registrar->registerFile(font.path.string());
  CHECK(registered.family == "Courier New");
  CHECK(registered.postScriptName == "CourierNewPSMT");
  CHECK(registrar->registerFile(font.path.string()).family == "Courier New");
}

TEST_CASE("CoreTextRegistrar refuses a file that is not a font, and one that is not there") {
  auto path = std::filesystem::temp_directory_path() / "ngn-test-not-a-font.ttf";
  std::ofstream(path) << "plain text";
  auto registrar = ngn::appkit::makeFontRegistrar();
  CHECK_THROWS_WITH(registrar->registerFile(path.string()), "the file is not a font CoreText reads");
  std::filesystem::remove(path);
  CHECK_THROWS_WITH(registrar->registerFile("/nowhere/font.ttf"), "there is no such file");
}

TEST_CASE("Text asks for a loaded font by the name it was loaded under, and picks the weight in its family") {
  auto library = std::make_shared<ngn::FontLibrary>();
  ngn::useFontLibrary(library);
  // A name no font was loaded under falls back to the system's.
  CHECK(fontOf("Typewriter").find("Courier") == std::string::npos);
  library->add("Typewriter", {.family = "Courier New", .postScriptName = "CourierNewPSMT"});
  CHECK(fontOf("Typewriter") == "CourierNewPSMT");
  CHECK(fontOf("Typewriter", facebook::react::FontWeight::Bold) == "CourierNewPS-BoldMT");
  ngn::useFontLibrary(nullptr);
}
