// React Native's cxx platform's view traits, with the desktop props (ngn/desktop-props.h): a view
// that asks for a cursor, takes focus or listens for a desktop element event keeps its children
// under it, as React Native keeps a view with `cursor` or a pointer listener, and so do a live
// region and a view with a role or a label. Without it Fabric
// flattens the view, mounting its children under an ancestor, and the hit test, the cursor and
// Tab order never see it. cmake/react-native.cmake puts this directory before React Native's own.
#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ShadowNodeTraits.h>

#include "ngn/desktop-props.h"

namespace facebook::react::HostPlatformViewTraitsInitializer {

inline bool formsStackingContext(const ViewProps &props) {
  // A live region reads its text from the views under it (ngn/live-regions.h), and an
  // accessibility element is read with the text inside it (ngn/accessibility.h).
  if (props.accessibilityLiveRegion != AccessibilityLiveRegion::None || props.role != Role::None ||
      !props.accessibilityRole.empty() || !props.accessibilityLabel.empty()) {
    return true;
  }
  const auto *desktop = dynamic_cast<const ngn::HasDesktopProps *>(&props);
  return desktop != nullptr && ngn::formsStackingContext(desktop->desktop);
}

inline bool formsView(const ViewProps & /*props*/) {
  return false;
}

inline bool isKeyboardFocusable(const ViewProps &props) {
  const auto *desktop = dynamic_cast<const ngn::HasDesktopProps *>(&props);
  return desktop != nullptr &&
      (desktop->desktop.focusable.value_or(false) || desktop->desktop.tabIndex.value_or(-1) >= 0);
}

} // namespace facebook::react::HostPlatformViewTraitsInitializer
