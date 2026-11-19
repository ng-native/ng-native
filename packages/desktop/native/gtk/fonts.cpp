#include "fonts.h"

#include <fontconfig/fontconfig.h>
#include <glib.h>

#include <atomic>
#include <mutex>
#include <stdexcept>

namespace ngn::gtk {

namespace {

std::atomic<uint64_t> gAdded{0};
std::mutex gLibraryMutex;
std::shared_ptr<const FontLibrary> gLibrary;

// The first face fontconfig's application fonts have from the file at `path`.
std::optional<RegisteredFont> applicationFontAt(const std::string &path) {
  FcFontSet *fonts = FcConfigGetFonts(nullptr, FcSetApplication);
  for (int i = 0; fonts && i < fonts->nfont; ++i) {
    FcChar8 *file = nullptr;
    int index = 0;
    if (FcPatternGetString(fonts->fonts[i], FC_FILE, 0, &file) != FcResultMatch || path != reinterpret_cast<const char *>(file)) {
      continue;
    }
    if (FcPatternGetInteger(fonts->fonts[i], FC_INDEX, 0, &index) == FcResultMatch && index != 0) {
      continue;
    }
    FcChar8 *family = nullptr, *postScript = nullptr;
    RegisteredFont font;
    if (FcPatternGetString(fonts->fonts[i], FC_FAMILY, 0, &family) == FcResultMatch) {
      font.family = reinterpret_cast<const char *>(family);
    }
    if (FcPatternGetString(fonts->fonts[i], FC_POSTSCRIPT_NAME, 0, &postScript) == FcResultMatch) {
      font.postScriptName = reinterpret_cast<const char *>(postScript);
    }
    return font;
  }
  return std::nullopt;
}

class FontconfigRegistrar final : public FontRegistrar {
 public:
  RegisteredFont registerFile(const std::string &path) override {
    std::lock_guard lock(mutex_);
    // Registered before, by this process: it is there to use.
    if (auto font = applicationFontAt(path)) {
      return *font;
    }
    if (!g_file_test(path.c_str(), G_FILE_TEST_IS_REGULAR)) {
      throw std::runtime_error("there is no such file");
    }
    if (!FcConfigAppFontAddFile(nullptr, reinterpret_cast<const FcChar8 *>(path.c_str()))) {
      throw std::runtime_error("the file is not a font fontconfig reads");
    }
    auto font = applicationFontAt(path);
    if (!font || font->family.empty()) {
      throw std::runtime_error("the file is not a font fontconfig reads");
    }
    ++gAdded;
    return *font;
  }

 private:
  std::mutex mutex_;
};

} // namespace

std::shared_ptr<FontRegistrar> makeFontRegistrar() {
  return std::make_shared<FontconfigRegistrar>();
}

void useFontLibrary(std::shared_ptr<const FontLibrary> library) {
  std::lock_guard lock(gLibraryMutex);
  gLibrary = std::move(library);
}

std::shared_ptr<const FontLibrary> fontLibrary() {
  std::lock_guard lock(gLibraryMutex);
  return gLibrary;
}

uint64_t fontsAdded() {
  return gAdded;
}

} // namespace ngn::gtk
