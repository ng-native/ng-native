// A host built without react-native-screens has no header to read.
#include "ngn/header-bar.h"

namespace ngn {

std::optional<HeaderBar> headerBar(const facebook::react::Props &) {
  return std::nullopt;
}

std::optional<std::string> headerItemType(const facebook::react::Props &) {
  return std::nullopt;
}

} // namespace ngn
