// Builders shared by the core tests.
#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/mounting/ShadowView.h>

#include <memory>

namespace ngn::testing {

inline facebook::react::ShadowView shadowView(
    facebook::react::Tag tag,
    const char *componentName,
    facebook::react::Rect frame,
    facebook::react::Props::Shared props = std::make_shared<const facebook::react::ViewProps>()) {
  facebook::react::ShadowView view;
  view.tag = tag;
  view.surfaceId = 1;
  view.componentName = componentName;
  view.layoutMetrics.frame = frame;
  view.props = std::move(props);
  return view;
}

// ViewProps with some fields set, for the hit test and hover tests.
inline std::shared_ptr<const facebook::react::ViewProps> viewProps(
    facebook::react::PointerEventsMode pointerEvents = facebook::react::PointerEventsMode::Auto,
    bool hover = false) {
  auto props = std::make_shared<facebook::react::ViewProps>();
  props->pointerEvents = pointerEvents;
  if (hover) {
    props->events[facebook::react::ViewEvents::Offset::PointerEnter] = true;
    props->events[facebook::react::ViewEvents::Offset::PointerLeave] = true;
  }
  return props;
}

} // namespace ngn::testing
