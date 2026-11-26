// `<visual-effect>` on a desktop host: a view drawn in one of the system's materials, behind its
// children, as NgNativeVisualEffect.
//
// The core reads the props into the effect to draw (visualEffectOf); the backend draws it. On
// macOS that is an NSVisualEffectView, which with `behind-window` blending shows what is behind the
// window, blurred, as a source list's sidebar does. The GTK backend has no material of its own and
// draws a plain view, so the app's own background shows there.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <string>

namespace ngn {

extern const char VisualEffectComponentName[];

class VisualEffectProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  VisualEffectProps() = default;
  VisualEffectProps(
      const facebook::react::PropsParserContext &context,
      const VisualEffectProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  // As the app sends them: a material's name, `behind-window` or `within-window`, and
  // `follows-window`, `active` or `inactive`.
  std::string material;
  std::string blendingMode;
  std::string state;
  bool emphasized{false};
};

// The effect a view draws. An unknown or unset name takes the default, so a misspelt material
// still draws the sidebar's.
struct VisualEffect {
  enum class Material {
    Sidebar,
    WindowBackground,
    UnderWindowBackground,
    ContentBackground,
    UnderPageBackground,
    HeaderView,
    Titlebar,
    Menu,
    Popover,
    Sheet,
    HudWindow,
    FullScreenUi,
    Tooltip,
    Selection,
  };
  enum class Blending { BehindWindow, WithinWindow };
  enum class State { FollowsWindow, Active, Inactive };
  Material material{Material::Sidebar};
  Blending blending{Blending::BehindWindow};
  State state{State::FollowsWindow};
  bool emphasized{false};
  bool operator==(const VisualEffect &) const = default;
};

VisualEffect visualEffectOf(const VisualEffectProps &props);

using VisualEffectShadowNode = facebook::react::
    ConcreteViewShadowNode<VisualEffectComponentName, VisualEffectProps, facebook::react::ViewEventEmitter>;
using VisualEffectComponentDescriptor = facebook::react::ConcreteComponentDescriptor<VisualEffectShadowNode>;

} // namespace ngn
