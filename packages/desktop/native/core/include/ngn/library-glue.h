// What the core reads and writes of the libraries' own component types (their props and state),
// which only a host built with the library can name. Each library's glue fills this in as the host
// registers its components (cmake/libraries.cmake); a host built without it leaves it empty.
#pragma once

#include "ngn/header-bar.h"
#include "ngn/module-registry.h"
#include "ngn/svg.h"
#include "ngn/tabs-host.h"
#include "ngn/web-view.h"

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>

#include <react/renderer/core/State.h>
#include <react/renderer/mounting/ShadowView.h>
#include <react/renderer/graphics/RectangleEdges.h>

#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct LibraryGlue {
  std::function<std::optional<HeaderBar>(const facebook::react::Props &)> headerBar;
  std::function<std::optional<std::string>(const facebook::react::Props &)> headerItemType;
  // Each sets a safe-area view's insets through its state, and answers false for another state.
  std::vector<std::function<bool(const facebook::react::State &, facebook::react::EdgeInsets)>> safeAreaStates;
  // Each reads how far a safe-area view's mounted state moves it (the margin its insets add), and
  // answers nothing for a view that pads its content instead, or another library's view.
  std::vector<std::function<std::optional<facebook::react::EdgeInsets>(const facebook::react::ShadowView &)>>
      safeAreaMargins;
  std::function<std::optional<TabScreen>(const facebook::react::Props &)> tabScreen;
  std::function<std::optional<TabsRequest>(const facebook::react::Props &)> tabsRequest;
  // The svg element a view's props are (svg.h), from react-native-svg's props.
  std::function<std::optional<SvgElement>(const facebook::react::Props &)> svgElement;
  // A web view's config (web-view.h), from react-native-webview's props.
  std::function<std::optional<WebViewConfig>(const facebook::react::Props &)> webViewConfig;
  // Components the desktop draws its own way, registered before the library's own and in place of
  // any of theirs with the same name.
  std::vector<facebook::react::ComponentDescriptorProvider> components;
  // TurboModules the library's glue implements in place of its iOS module (react-native-worklets'
  // WorkletsModule, Reanimated's ReanimatedModule), by name. The registry asks these after the
  // core's own modules.
  std::map<std::string, ModuleRegistry::Factory> modules;
};

LibraryGlue &libraryGlue();

} // namespace ngn
