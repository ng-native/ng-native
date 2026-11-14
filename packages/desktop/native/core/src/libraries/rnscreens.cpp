// The core's reading of react-native-screens' props, compiled into the host only with the library
// (cmake/libraries.cmake). Everything else in the host reads the plain data in header-bar.h.
#include "ngn/header-bar.h"

#include <react/renderer/components/rnscreens/Props.h>

using namespace facebook::react;

namespace ngn {

std::optional<HeaderBar> headerBar(const Props &props) {
  const auto *p = dynamic_cast<const RNSScreenStackHeaderConfigProps *>(&props);
  if (p == nullptr) {
    return std::nullopt;
  }
  return HeaderBar{
      .hidden = p->hidden,
      .title = p->title,
      .titleColor = p->titleColor,
      .titleFontFamily = p->titleFontFamily,
      .titleFontSize = p->titleFontSize,
      .titleFontWeight = p->titleFontWeight,
      .color = p->color,
      .backgroundColor = p->backgroundColor,
      .hideBackButton = p->hideBackButton,
      .hideShadow = p->hideShadow,
      .left = barButtons(p->headerLeftBarButtonItems),
      .right = barButtons(p->headerRightBarButtonItems),
  };
}

std::optional<std::string> headerItemType(const Props &props) {
  const auto *p = dynamic_cast<const RNSScreenStackHeaderSubviewProps *>(&props);
  if (p == nullptr) {
    return std::nullopt;
  }
  return toString(p->type);
}

} // namespace ngn
