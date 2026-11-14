#include "ngn/library-glue.h"

namespace ngn {

LibraryGlue &libraryGlue() {
  static LibraryGlue glue;
  return glue;
}

std::optional<HeaderBar> headerBar(const facebook::react::Props &props) {
  const auto &read = libraryGlue().headerBar;
  return read ? read(props) : std::nullopt;
}

std::optional<std::string> headerItemType(const facebook::react::Props &props) {
  const auto &read = libraryGlue().headerItemType;
  return read ? read(props) : std::nullopt;
}

} // namespace ngn
