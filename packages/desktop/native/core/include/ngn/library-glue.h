// What the core reads and writes of the libraries' own component types (their props and state),
// which only a host built with the library can name. Each library's glue fills this in as the host
// registers its components (cmake/libraries.cmake); a host built without it leaves it empty.
#pragma once

#include "ngn/header-bar.h"
#include "ngn/tabs-host.h"

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>

#include <react/renderer/core/State.h>
#include <react/renderer/graphics/RectangleEdges.h>

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct LibraryGlue {
  std::function<std::optional<HeaderBar>(const facebook::react::Props &)> headerBar;
  std::function<std::optional<std::string>(const facebook::react::Props &)> headerItemType;
  // Each sets a safe-area view's insets through its state, and answers false for another state.
  std::vector<std::function<bool(const facebook::react::State &, facebook::react::EdgeInsets)>> safeAreaStates;
  std::function<std::optional<TabScreen>(const facebook::react::Props &)> tabScreen;
  std::function<std::optional<TabsRequest>(const facebook::react::Props &)> tabsRequest;
  // Components the desktop draws its own way, registered before the library's own and in place of
  // any of theirs with the same name.
  std::vector<facebook::react::ComponentDescriptorProvider> components;
};

LibraryGlue &libraryGlue();

} // namespace ngn
