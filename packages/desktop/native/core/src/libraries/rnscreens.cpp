// The core's reading of react-native-screens' props and state, compiled into the host only with
// the library (cmake/libraries.cmake).
#include "ngn/library-glue.h"

#include <react/renderer/components/rnscreens/Props.h>
#include <react/renderer/components/rnscreens/RNSSafeAreaViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace ngn {

void installGlue_rnscreens() {
  auto &glue = libraryGlue();
  glue.headerBar = [](const Props &props) -> std::optional<HeaderBar> {
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
  };
  glue.headerItemType = [](const Props &props) -> std::optional<std::string> {
    const auto *p = dynamic_cast<const RNSScreenStackHeaderSubviewProps *>(&props);
    return p == nullptr ? std::nullopt : std::optional<std::string>(toString(p->type));
  };
  glue.safeAreaStates.emplace_back([](const State &state, EdgeInsets insets) {
    const auto *concrete = dynamic_cast<const ConcreteState<RNSSafeAreaViewState> *>(&state);
    if (concrete == nullptr) {
      return false;
    }
    concrete->updateState(RNSSafeAreaViewState(insets));
    return true;
  });
}

} // namespace ngn
