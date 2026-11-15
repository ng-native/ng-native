// `<expo-glass>` and `<expo-glass-container>` on a desktop host: expo-glass-effect's views
// (ViewManagerAdapter_ExpoGlassEffect_GlassView and _GlassContainer, the components
// `registerExpoViews('expo-glass', 'expo-glass-container')` commits) as Fabric components.
//
// The core reads the props into the glass to draw (glassOf); the backend draws it with its
// toolkit's material behind the view's children, in the view's own corners. On macOS that is
// NSGlassEffectView from macOS 26 and an NSVisualEffectView before it, as the iOS view is a plain
// view before iOS 26. A container is a plain view on macOS: its glass views each draw their own.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/graphics/Color.h>

#include <folly/dynamic.h>

#include <optional>
#include <string>

namespace ngn {

extern const char GlassViewComponentName[];
extern const char GlassContainerComponentName[];

class GlassProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  GlassProps() = default;
  GlassProps(
      const facebook::react::PropsParserContext &context,
      const GlassProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  // `regular`, `clear` or `none`, or `{ style, animate, animationDuration }`, as the app sends it.
  folly::dynamic glassEffectStyle;
  facebook::react::SharedColor tintColor;
  bool isInteractive{false};
  // `auto`, `light` or `dark`.
  std::string colorScheme;
  // The container's.
  double spacing{0};
};

// The glass a view draws: nothing for `none`.
struct Glass {
  enum class Style { Regular, Clear };
  Style style{Style::Regular};
  facebook::react::SharedColor tint;
  bool interactive{false};
  // Unset follows the app's appearance.
  std::optional<bool> dark;
  bool operator==(const Glass &) const = default;
};

std::optional<Glass> glassOf(const GlassProps &props);

using GlassViewShadowNode =
    facebook::react::ConcreteViewShadowNode<GlassViewComponentName, GlassProps, facebook::react::ViewEventEmitter>;
using GlassViewComponentDescriptor = facebook::react::ConcreteComponentDescriptor<GlassViewShadowNode>;
using GlassContainerShadowNode = facebook::react::
    ConcreteViewShadowNode<GlassContainerComponentName, GlassProps, facebook::react::ViewEventEmitter>;
using GlassContainerComponentDescriptor = facebook::react::ConcreteComponentDescriptor<GlassContainerShadowNode>;

} // namespace ngn
