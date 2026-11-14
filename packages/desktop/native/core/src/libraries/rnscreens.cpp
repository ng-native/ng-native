// The core's reading of react-native-screens' props and state, compiled into the host only with
// the library (cmake/libraries.cmake).
#include "ngn/library-glue.h"
#include "ngn/screen-presentation.h"
#include "ngn/split-view.h"

#include <react/renderer/components/rnscreens/EventEmitters.h>
#include <react/renderer/components/rnscreens/ShadowNodes.h>

#include <react/renderer/components/rnscreens/Props.h>
#include <react/renderer/components/rnscreens/RNSSafeAreaViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace facebook::react {
// The library's own (RNSScreenShadowNode.cpp), whose shadow node the desktop replaces.
extern const char RNSScreenComponentName[];
} // namespace facebook::react

namespace ngn {

namespace {

// A tab's screen fills the content pane its tabs host is drawn in: the pane's size is its state.
using TabsScreenShadowNode =
    ConcreteViewShadowNode<RNSTabsScreenIOSComponentName, RNSTabsScreenIOSProps, RNSTabsScreenIOSEventEmitter, SplitPaneState>;

// A screen with the props the desktop reads, `anchor` among them, which the library's drop
// (screen-presentation.h); presented, it takes the size it is presented at.
using ScreenShadowNode = ConcreteViewShadowNode<RNSScreenComponentName, ScreenProps, RNSScreenEventEmitter, SplitPaneState>;

} // namespace

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
  glue.tabScreen = [](const Props &props) -> std::optional<TabScreen> {
    const auto *p = dynamic_cast<const RNSTabsScreenIOSProps *>(&props);
    if (p == nullptr) {
      return std::nullopt;
    }
    return TabScreen{
        .screenKey = p->screenKey,
        .title = p->title,
        .badge = p->badgeValue,
        .sfSymbol = p->iconType == RNSTabsScreenIOSIconType::SfSymbol ? p->iconResourceName : std::string{},
        .preventNativeSelection = p->preventNativeSelection,
    };
  };
  glue.tabsRequest = [](const Props &props) -> std::optional<TabsRequest> {
    const auto *p = dynamic_cast<const RNSTabsHostIOSProps *>(&props);
    if (p == nullptr) {
      return std::nullopt;
    }
    return TabsRequest{
        .screenKey = p->navStateRequest.selectedScreenKey,
        .baseProvenance = p->navStateRequest.baseProvenance,
        .rejectStale = p->rejectStaleNavStateUpdates,
    };
  };
  glue.components.push_back(concreteComponentDescriptorProvider<ToolkitSizedComponentDescriptor<TabsScreenShadowNode>>());
  glue.components.push_back(concreteComponentDescriptorProvider<ToolkitSizedComponentDescriptor<ScreenShadowNode>>());
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
