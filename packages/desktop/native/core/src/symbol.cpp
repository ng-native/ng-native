#include "ngn/symbol.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/propsConversions.h>

#include <algorithm>

using namespace facebook::react;

namespace ngn {

const char SymbolComponentName[] = "ViewManagerAdapter_SymbolModule";

SymbolProps::SymbolProps(const PropsParserContext &context, const SymbolProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      name(convertRawProp(context, rawProps, "name", sourceProps.name, {})),
      type(convertRawProp(context, rawProps, "type", sourceProps.type, std::string{"monochrome"})),
      scale(convertRawProp(context, rawProps, "scale", sourceProps.scale, {})),
      weight(convertRawProp(context, rawProps, "weight", sourceProps.weight, {})),
      tintColor(convertRawProp(context, rawProps, "tintColor", sourceProps.tintColor, {})),
      colors(convertRawProp(context, rawProps, "colors", sourceProps.colors, {})),
      resizeMode(convertRawProp(context, rawProps, "resizeMode", sourceProps.resizeMode, {})) {}

SymbolPaint symbolPaint(const SymbolProps &props) {
  std::vector<SharedColor> tint;
  if (props.tintColor) {
    tint.push_back(props.tintColor);
  }
  if (props.type == "hierarchical") {
    return {SymbolPaint::Mode::Hierarchical, tint};
  }
  if (props.type == "multicolor") {
    return {SymbolPaint::Mode::Multicolor, tint};
  }
  if (props.type == "palette" && props.colors.size() > 1) {
    return {SymbolPaint::Mode::Palette, props.colors};
  }
  return {SymbolPaint::Mode::Monochrome, tint};
}

SymbolRect placeSymbol(std::string_view mode, std::pair<double, double> image, std::pair<double, double> box) {
  auto [width, height] = image;
  auto [boxWidth, boxHeight] = box;
  if (width <= 0 || height <= 0) {
    return {};
  }
  if (mode == "scaleToFill" || mode == "redraw") {
    return {0, 0, boxWidth, boxHeight};
  }
  bool fill = mode == "scaleAspectFill";
  bool natural = mode == "center" || mode == "top" || mode == "bottom" || mode == "left" || mode == "right" ||
      mode == "topLeft" || mode == "topRight" || mode == "bottomLeft" || mode == "bottomRight";
  if (!natural) {
    double scale = fill ? std::max(boxWidth / width, boxHeight / height) : std::min(boxWidth / width, boxHeight / height);
    width *= scale;
    height *= scale;
  }
  // The centre, unless the mode names an edge.
  double x = (boxWidth - width) / 2, y = (boxHeight - height) / 2;
  if (mode == "top" || mode == "topLeft" || mode == "topRight") {
    y = 0;
  }
  if (mode == "bottom" || mode == "bottomLeft" || mode == "bottomRight") {
    y = boxHeight - height;
  }
  if (mode == "left" || mode == "topLeft" || mode == "bottomLeft") {
    x = 0;
  }
  if (mode == "right" || mode == "topRight" || mode == "bottomRight") {
    x = boxWidth - width;
  }
  return {x, y, width, height};
}

std::shared_ptr<NativeModule> makeSymbolModule(std::shared_ptr<SymbolMeasurer> measurer) {
  struct Symbol : NativeModule {
    explicit Symbol(std::shared_ptr<SymbolMeasurer> measurer) : NativeModule("NgNativeSymbol") {
      sync("imageSize", [measurer](const folly::dynamic &args) {
        if (args.size() < 2 || !args[0].isString() || !args[1].isNumber()) {
          return folly::dynamic(nullptr);
        }
        auto text = [&](size_t i) { return args.size() > i && args[i].isString() ? args[i].asString() : std::string(); };
        auto size = measurer->imageSize(args[0].asString(), args[1].asDouble(), text(2), text(3));
        return size ? folly::dynamic::array(size->first, size->second) : folly::dynamic(nullptr);
      });
    }
  };
  return std::make_shared<Symbol>(std::move(measurer));
}

} // namespace ngn
