// Fonts on Linux: a font file added to fontconfig for the process, and text naming it by the name
// it was loaded under. The name's family resolution and the module's calls are the core's.
#include "../fonts.h"
#include "../pango-text.h"
#include "mounted-views.h"

#include <doctest/doctest.h>
#include <fontconfig/fontconfig.h>
#include <glib.h>

#include <filesystem>
#include <memory>
#include <string>

namespace {

// The first file fontconfig knows for a family, or empty.
std::string fileOf(const char *family) {
  FcPattern *pattern = FcNameParse(reinterpret_cast<const FcChar8 *>(family));
  FcObjectSet *objects = FcObjectSetBuild(FC_FILE, FC_FAMILY, nullptr);
  FcFontSet *fonts = FcFontList(nullptr, pattern, objects);
  std::string file;
  for (int i = 0; fonts && i < fonts->nfont && file.empty(); ++i) {
    FcChar8 *path = nullptr;
    if (FcPatternGetString(fonts->fonts[i], FC_FILE, 0, &path) == FcResultMatch) {
      file = reinterpret_cast<const char *>(path);
    }
  }
  if (fonts) {
    FcFontSetDestroy(fonts);
  }
  FcObjectSetDestroy(objects);
  FcPatternDestroy(pattern);
  return file;
}

double widthOf(const std::string &text, const std::string &family) {
  facebook::react::AttributedString string;
  facebook::react::TextAttributes attributes;
  attributes.fontFamily = family;
  attributes.fontSize = 20;
  string.appendFragment({text, attributes, {}});
  return ngn::gtk::layoutText(string, {}, std::numeric_limits<facebook::react::Float>::infinity()).size.width;
}

struct Copy {
  std::filesystem::path path;
  Copy(const std::string &from, const char *name) {
    gchar *dir = g_dir_make_tmp("ngn-fonts-XXXXXX", nullptr);
    path = std::filesystem::path(dir) / name;
    g_free(dir);
    std::filesystem::copy_file(from, path);
  }
  ~Copy() {
    std::filesystem::remove_all(path.parent_path());
  }
};

} // namespace

TEST_CASE("Fonts on Linux registers a font file with fontconfig, once, and refuses what is not a font") {
  auto source = fileOf("Source Code Pro");
  // In the CI image, with GTK's fonts.
  REQUIRE_FALSE(source.empty());
  Copy copy(source, "Code.otf");
  auto registrar = ngn::gtk::makeFontRegistrar();
  auto added = ngn::gtk::fontsAdded();
  auto font = registrar->registerFile(copy.path.string());
  CHECK(font.family == "Source Code Pro");
  CHECK_FALSE(font.postScriptName.empty());
  CHECK(ngn::gtk::fontsAdded() == added + 1);
  // Again: the same font, not added twice.
  CHECK(registrar->registerFile(copy.path.string()).family == "Source Code Pro");
  CHECK(ngn::gtk::fontsAdded() == added + 1);

  auto notFont = copy.path.parent_path() / "notes.txt";
  g_file_set_contents(notFont.c_str(), "not a font", -1, nullptr);
  CHECK_THROWS_WITH(registrar->registerFile(notFont.string()), "the file is not a font fontconfig reads");
  CHECK_THROWS_WITH(registrar->registerFile((copy.path.parent_path() / "missing.otf").string()), "there is no such file");
}

TEST_CASE("text names a loaded font by the name it was loaded under") {
  REQUIRE(ngn::testing::gtkReady());
  auto source = fileOf("Source Code Pro");
  // In the CI image, with GTK's fonts.
  REQUIRE_FALSE(source.empty());
  // Before the name is loaded it names no family: the fallback's i is narrow.
  double before = widthOf("iiiiiiiiii", "CodeFace");
  Copy copy(source, "CodeFace.otf");
  auto library = std::make_shared<ngn::FontLibrary>();
  library->add("CodeFace", ngn::gtk::makeFontRegistrar()->registerFile(copy.path.string()));
  ngn::gtk::useFontLibrary(library);
  // A monospaced i is as wide as an m.
  double after = widthOf("iiiiiiiiii", "CodeFace");
  CHECK(after > before * 1.5);
  CHECK(after == doctest::Approx(widthOf("mmmmmmmmmm", "CodeFace")).epsilon(0.01));
  ngn::gtk::useFontLibrary(nullptr);
}
