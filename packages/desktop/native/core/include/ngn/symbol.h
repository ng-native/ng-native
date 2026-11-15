// `<expo-symbol>` on a desktop host: expo-symbols' view (ViewManagerAdapter_SymbolModule, the
// component `registerExpoViews('expo-symbol')` commits) as a Fabric component, and the
// NgNativeSymbol module that sizes it, as @ng-native/expo's iOS module does.
//
// The core reads the props and decides what is drawn where: the paint (expo-symbols' type, tint
// and palette as a rendering mode and its colours) and the symbol's rectangle in the view, as
// UIKit's content mode `resizeMode` names places an image. The backend's view draws the SF Symbol
// with its toolkit at the system font size, as expo-symbols builds it, scaled into that rectangle.
//
// - NgNativeSymbol.imageSize(name, pointSize, weight, scale): [width, height] of the symbol's image
//   at that point size, or null for a name the OS has no symbol for.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/native-module.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/graphics/Color.h>

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace ngn {

extern const char SymbolComponentName[];

class SymbolProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  SymbolProps() = default;
  SymbolProps(
      const facebook::react::PropsParserContext &context,
      const SymbolProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  std::string name;
  // `monochrome`, `hierarchical`, `palette` or `multicolor`.
  std::string type{"monochrome"};
  // expo-symbols' scale and weight names; empty for the default.
  std::string scale;
  std::string weight;
  facebook::react::SharedColor tintColor;
  std::vector<facebook::react::SharedColor> colors;
  // UIKit's content modes by name; empty for `scaleAspectFit`.
  std::string resizeMode;
};

using SymbolShadowNode =
    facebook::react::ConcreteViewShadowNode<SymbolComponentName, SymbolProps, facebook::react::ViewEventEmitter>;
using SymbolComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SymbolShadowNode>;

// How the symbol's layers are coloured, as expo-symbols configures it.
struct SymbolPaint {
  enum class Mode { Monochrome, Hierarchical, Palette, Multicolor };
  Mode mode{Mode::Monochrome};
  // Monochrome: the one colour, or none for the label colour. Hierarchical: the one colour, or
  // none for the system blue. Palette: two or more. Multicolor: the tint for the layers with no
  // colour of their own, or none.
  std::vector<facebook::react::SharedColor> colors;
};

SymbolPaint symbolPaint(const SymbolProps &props);

struct SymbolRect {
  double x{0}, y{0}, width{0}, height{0};
  bool operator==(const SymbolRect &) const = default;
};

// Where an image of `image` size draws in a view of `box` size, from its top left, as UIKit's
// content mode `resizeMode` places it: scaled to fill, to fit, to fill keeping its ratio, or at its
// own size at the centre, an edge or a corner. An empty or unknown mode fits it.
SymbolRect placeSymbol(std::string_view resizeMode, std::pair<double, double> image, std::pair<double, double> box);

class SymbolMeasurer {
 public:
  virtual ~SymbolMeasurer() = default;
  // The size of the symbol's image at `pointSize`, or nothing for a name with no symbol.
  virtual std::optional<std::pair<double, double>> imageSize(
      const std::string &name, double pointSize, const std::string &weight, const std::string &scale) = 0;
};

std::shared_ptr<NativeModule> makeSymbolModule(std::shared_ptr<SymbolMeasurer> measurer);

} // namespace ngn
