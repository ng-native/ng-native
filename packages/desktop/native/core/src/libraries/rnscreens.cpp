// The core's reading of react-native-screens' props and state, compiled into the host only with
// the library (cmake/libraries.cmake).
#include "ngn/library-glue.h"
#include "ngn/screen-presentation.h"
#include "ngn/split-view.h"
#include "ngn/svg-markup.h"

#include <react/renderer/components/rnscreens/EventEmitters.h>
#include <react/renderer/components/rnscreens/ShadowNodes.h>

#include <react/renderer/components/rnscreens/Props.h>
#include <react/renderer/components/rnscreens/RNSSafeAreaViewState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutContext.h>

using namespace facebook::react;

namespace facebook::react {
// The library's own (RNSScreenShadowNode.cpp), whose shadow node the desktop replaces.
extern const char RNSScreenComponentName[];
// The library's own (RNSScreenStackHeaderConfigShadowNode.cpp), whose shadow node the desktop
// replaces too.
extern const char RNSScreenStackHeaderConfigComponentName[];
} // namespace facebook::react

namespace ngn {

namespace {

// A tab's screen fills the content pane its tabs host is drawn in: the pane's size is its state.
using TabsScreenShadowNode =
    ConcreteViewShadowNode<RNSTabsScreenIOSComponentName, RNSTabsScreenIOSProps, RNSTabsScreenIOSEventEmitter, SplitPaneState>;

// A screen with the props the desktop reads, `anchor` among them, which the library's drop
// (screen-presentation.h); presented, it takes the size it is presented at.
using ScreenShadowNode = ConcreteViewShadowNode<RNSScreenComponentName, ScreenProps, RNSScreenEventEmitter, SplitPaneState>;

// A header config's props, the library's and the desktop's own `subtitle` beside them: the
// library's class is final, so it is held rather than extended.
class HeaderConfigProps final : public ViewProps {
 public:
  HeaderConfigProps() = default;
  HeaderConfigProps(const PropsParserContext &context, const HeaderConfigProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        screens(context, sourceProps.screens, rawProps),
        subtitle(convertRawProp(context, rawProps, "subtitle", sourceProps.subtitle, std::string{})) {}

  RNSScreenStackHeaderConfigProps screens;
  std::string subtitle;
};

// A header config with those props. Its frame starts at the screen's corner, where the library's
// node puts it from a state the desktop never sets.
class HeaderConfigShadowNode final : public ConcreteViewShadowNode<
                                         RNSScreenStackHeaderConfigComponentName,
                                         HeaderConfigProps,
                                         RNSScreenStackHeaderConfigEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  void layout(LayoutContext layoutContext) override {
    ConcreteViewShadowNode::layout(layoutContext);
    ensureUnsealed();
    layoutMetrics_.frame.origin = {0, 0};
  }
};

} // namespace

void installGlue_rnscreens() {
  auto &glue = libraryGlue();
  glue.headerBar = [](const Props &props) -> std::optional<HeaderBar> {
    const auto *config = dynamic_cast<const HeaderConfigProps *>(&props);
    if (config == nullptr) {
      return std::nullopt;
    }
    const auto *p = &config->screens;
    return HeaderBar{
        .hidden = p->hidden,
        .title = p->title,
        .subtitle = config->subtitle,
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
  glue.searchBarConfig = [](const Props &props) -> std::optional<SearchBarConfig> {
    const auto *p = dynamic_cast<const RNSSearchBarProps *>(&props);
    if (p == nullptr) {
      return std::nullopt;
    }
    return SearchBarConfig{
        .placeholder = p->placeholder,
        .autoCapitalize = toString(p->autoCapitalize),
        .tintColor = p->tintColor,
        .textColor = p->textColor,
    };
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
        // `<native-tab [icon]="{ svg }">` commits its markup on a desktop as a data uri.
        .svgIcon = svgMarkupOfUri(p->iconImageSource.uri).value_or(""),
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
  glue.components.push_back(concreteComponentDescriptorProvider<ConcreteComponentDescriptor<HeaderConfigShadowNode>>());
  glue.safeAreaStates.emplace_back([](const State &state, EdgeInsets insets) {
    const auto *concrete = dynamic_cast<const ConcreteState<RNSSafeAreaViewState> *>(&state);
    if (concrete == nullptr) {
      return false;
    }
    concrete->updateState(RNSSafeAreaViewState(insets));
    return true;
  });
  // RNSSafeAreaViewShadowNode adds each of its edges' insets to its margin.
  glue.safeAreaMargins.emplace_back([](const ShadowView &view) -> std::optional<EdgeInsets> {
    const auto *props = dynamic_cast<const RNSSafeAreaViewProps *>(view.props.get());
    const auto *state = dynamic_cast<const ConcreteState<RNSSafeAreaViewState> *>(view.state.get());
    if (props == nullptr || state == nullptr) {
      return std::nullopt;
    }
    auto insets = state->getData().insets;
    const auto &edges = props->edges;
    return EdgeInsets{
        .left = edges.left ? insets.left : 0,
        .top = edges.top ? insets.top : 0,
        .right = edges.right ? insets.right : 0,
        .bottom = edges.bottom ? insets.bottom : 0,
    };
  });
}

} // namespace ngn
