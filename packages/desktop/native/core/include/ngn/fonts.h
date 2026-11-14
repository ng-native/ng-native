// NgNativeFont: what @ng-native/expo's Fonts calls on expo-font, over a FontRegistrar, which the
// AppKit backend implements with CTFontManager, registering a font for this process only.
//
// - loadAsync(name, uri): registers the font file a `file:` uri or an absolute path names, or that
//   an `http(s):` uri serves (an asset from the dev server), downloaded into the cache first, and
//   makes `name` stand for its family. A file registered before is not registered again.
// - isLoaded(name), getLoadedFonts(): the names loaded, in the order they were.
// Text asks for a font by its name: FontLibrary::familyOf answers the family it stands for, as
// expo-font's alias does on iOS, so text in that family picks its weight among the faces loaded.
#pragma once

#include "ngn/native-module.h"
#include "ngn/network.h"

#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct RegisteredFont {
  std::string family;
  std::string postScriptName;
};

class FontRegistrar {
 public:
  virtual ~FontRegistrar() = default;
  // Registers the first face in the file at `path`, or one already registered, for this process.
  // Throws std::runtime_error with the OS's reason when it cannot.
  virtual RegisteredFont registerFile(const std::string &path) = 0;
};

// The names fonts are loaded under, for the process: one library both the module and text layout
// read, kept across reloads, as the registered fonts are. Any thread.
class FontLibrary {
 public:
  void add(const std::string &name, RegisteredFont font);
  bool has(const std::string &name) const;
  // The family `name` stands for, or nothing for a name no font was loaded under.
  std::optional<RegisteredFont> fontOf(const std::string &name) const;
  std::vector<std::string> names() const;

 private:
  mutable std::mutex mutex_;
  std::map<std::string, RegisteredFont> fonts_;
  std::vector<std::string> order_;
};

// `downloads` is where a font served over http(s) is saved before it is registered.
std::shared_ptr<NativeModule> makeFontModule(
    std::shared_ptr<FontRegistrar> registrar,
    std::shared_ptr<FontLibrary> library,
    std::shared_ptr<Http> http,
    std::string downloads);

} // namespace ngn
