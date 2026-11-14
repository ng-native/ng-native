// The core's reading of react-native-svg's props into svg elements (svg.h), compiled into the host
// only with the library (cmake/libraries.cmake).
//
// It also registers two components of the desktop's own: RNSVGSvgView, which the library's Android
// build leaves out of its list (Android draws into RNSVGSvgViewAndroid), and the two gradients,
// whose codegen props read their stops' colours as `float`, which rounds an ARGB colour's low bits
// off: here they are read as `double`, as React Native iOS's CGFloat does.
#include "ngn/library-glue.h"
#include "ngn/svg.h"

#include <react/renderer/components/rnsvg/ComponentDescriptors.h>
#include <react/renderer/components/rnsvg/RNSVGComponentDescriptors.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/graphics/ColorComponents.h>

#include <cmath>
#include <type_traits>

using namespace facebook::react;

namespace ngn {

namespace {

// A gradient's props, its stops' colours read at full precision.
class GradientProps : public ViewProps {
 public:
  GradientProps() = default;
  GradientProps(const PropsParserContext &context, const GradientProps &source, const RawProps &raw)
      : ViewProps(context, source, raw),
        name(convertRawProp(context, raw, "name", source.name, {})),
        x1(convertRawProp(context, raw, "x1", source.x1, {})),
        y1(convertRawProp(context, raw, "y1", source.y1, {})),
        x2(convertRawProp(context, raw, "x2", source.x2, {})),
        y2(convertRawProp(context, raw, "y2", source.y2, {})),
        cx(convertRawProp(context, raw, "cx", source.cx, {})),
        cy(convertRawProp(context, raw, "cy", source.cy, {})),
        rx(convertRawProp(context, raw, "rx", source.rx, {})),
        ry(convertRawProp(context, raw, "ry", source.ry, {})),
        fx(convertRawProp(context, raw, "fx", source.fx, {})),
        fy(convertRawProp(context, raw, "fy", source.fy, {})),
        gradient(convertRawProp(context, raw, "gradient", source.gradient, {})),
        gradientUnits(convertRawProp(context, raw, "gradientUnits", source.gradientUnits, 0)),
        gradientTransform(convertRawProp(context, raw, "gradientTransform", source.gradientTransform, {})) {}

  std::string name;
  folly::dynamic x1, y1, x2, y2, cx, cy, rx, ry, fx, fy;
  std::vector<double> gradient;
  int gradientUnits{0};
  std::vector<double> gradientTransform;
};

class LinearGradientProps final : public GradientProps {
 public:
  using GradientProps::GradientProps;
};

class RadialGradientProps final : public GradientProps {
 public:
  using GradientProps::GradientProps;
};

using LinearGradientShadowNode = RNSVGConcreteShadowNode<RNSVGLinearGradientComponentName, LinearGradientProps>;
using RadialGradientShadowNode = RNSVGConcreteShadowNode<RNSVGRadialGradientComponentName, RadialGradientProps>;

std::optional<SvgMatrix> matrixOf(const auto &values) {
  if (values.size() != 6) {
    return std::nullopt;
  }
  return SvgMatrix{
      static_cast<double>(values[0]),
      static_cast<double>(values[1]),
      static_cast<double>(values[2]),
      static_cast<double>(values[3]),
      static_cast<double>(values[4]),
      static_cast<double>(values[5])};
}

std::optional<uint32_t> argbOf(const SharedColor &color) {
  if (!color) {
    return std::nullopt;
  }
  auto c = colorComponentsFromColor(color);
  auto channel = [](float v) { return static_cast<uint32_t>(std::lround(std::clamp(v, 0.0f, 1.0f) * 255)); };
  return channel(c.alpha) << 24 | channel(c.red) << 16 | channel(c.green) << 8 | channel(c.blue);
}

void lengths(SvgElement &e, std::initializer_list<std::pair<const char *, const folly::dynamic *>> values) {
  for (const auto &[name, value] : values) {
    auto length = svgLength(*value);
    if (length.set) {
      e.lengths[name] = length;
    }
  }
}

// What every element shares: its name, transform, opacity, clip and mask, and its presentation.
template <typename P>
void common(SvgElement &e, const P &p) {
  e.name = p.name;
  e.opacity = p.opacity;
  e.matrix = matrixOf(p.matrix);
  if constexpr (requires { p.clipPath; }) {
    e.clipPath = p.clipPath;
    e.clipRule = p.clipRule;
    e.mask = p.mask;
    e.hidden = p.display == "none";
  }
  if constexpr (requires { p.fill; }) {
    e.color = argbOf(p.color);
    e.propList = p.propList;
    e.fill = svgBrush(p.fill);
    e.fillOpacity = p.fillOpacity;
    e.fillRule = p.fillRule;
    e.stroke = svgBrush(p.stroke);
    e.strokeOpacity = p.strokeOpacity;
    e.strokeWidth = svgLength(p.strokeWidth);
    e.strokeLinecap = p.strokeLinecap;
    e.strokeLinejoin = p.strokeLinejoin;
    e.strokeDasharray = svgLengths(p.strokeDasharray);
    e.strokeDashoffset = p.strokeDashoffset;
    e.strokeMiterlimit = p.strokeMiterlimit;
  }
  if constexpr (requires { p.font; }) {
    const auto &font = p.font;
    auto size = font.isObject() ? font.getDefault("fontSize", nullptr) : folly::dynamic(nullptr);
    e.fontSize = svgLength(size.isNull() ? p.fontSize : size);
    if (font.isObject()) {
      auto family = font.getDefault("fontFamily", "");
      auto weight = font.getDefault("fontWeight", "");
      e.fontFamily = family.isString() ? family.getString() : "";
      e.fontWeight = weight.isString() ? weight.getString() : weight.isNumber() ? std::to_string(weight.asInt()) : "";
    }
  }
}

template <typename P>
void text(SvgElement &e, const P &p) {
  e.xs = svgLengths(p.x);
  e.ys = svgLengths(p.y);
  e.dxs = svgLengths(p.dx);
  e.dys = svgLengths(p.dy);
}

void stops(SvgElement &e, const GradientProps &p) {
  for (size_t i = 0; i + 1 < p.gradient.size(); i += 2) {
    e.stops.emplace_back(p.gradient[i], static_cast<uint32_t>(static_cast<int64_t>(p.gradient[i + 1])));
  }
  e.units = p.gradientUnits;
  e.gradientTransform = matrixOf(p.gradientTransform);
}

std::optional<SvgElement> svgElement(const Props &props) {
  SvgElement e;
  if (const auto *p = dynamic_cast<const RNSVGSvgViewProps *>(&props)) {
    e.kind = SvgKind::Svg;
    e.color = argbOf(p->color);
    e.minX = p->minX;
    e.minY = p->minY;
    e.vbWidth = p->vbWidth;
    e.vbHeight = p->vbHeight;
    e.align = p->align;
    e.meetOrSlice = p->meetOrSlice;
    e.bbWidth = svgLength(p->bbWidth);
    e.bbHeight = svgLength(p->bbHeight);
    return e;
  }
  if (const auto *p = dynamic_cast<const RNSVGGroupProps *>(&props)) {
    e.kind = SvgKind::Group;
    common(e, *p);
  } else if (const auto *p = dynamic_cast<const RNSVGPathProps *>(&props)) {
    e.kind = SvgKind::Path;
    common(e, *p);
    e.d = p->d;
  } else if (const auto *p = dynamic_cast<const RNSVGRectProps *>(&props)) {
    e.kind = SvgKind::Rect;
    common(e, *p);
    lengths(e, {{"x", &p->x}, {"y", &p->y}, {"width", &p->width}, {"height", &p->height}, {"rx", &p->rx}, {"ry", &p->ry}});
  } else if (const auto *p = dynamic_cast<const RNSVGCircleProps *>(&props)) {
    e.kind = SvgKind::Circle;
    common(e, *p);
    lengths(e, {{"cx", &p->cx}, {"cy", &p->cy}, {"r", &p->r}});
  } else if (const auto *p = dynamic_cast<const RNSVGEllipseProps *>(&props)) {
    e.kind = SvgKind::Ellipse;
    common(e, *p);
    lengths(e, {{"cx", &p->cx}, {"cy", &p->cy}, {"rx", &p->rx}, {"ry", &p->ry}});
  } else if (const auto *p = dynamic_cast<const RNSVGLineProps *>(&props)) {
    e.kind = SvgKind::Line;
    common(e, *p);
    lengths(e, {{"x1", &p->x1}, {"y1", &p->y1}, {"x2", &p->x2}, {"y2", &p->y2}});
  } else if (const auto *p = dynamic_cast<const RNSVGUseProps *>(&props)) {
    e.kind = SvgKind::Use;
    common(e, *p);
    e.href = p->href;
    lengths(e, {{"x", &p->x}, {"y", &p->y}, {"width", &p->width}, {"height", &p->height}});
  } else if (const auto *p = dynamic_cast<const RNSVGDefsProps *>(&props)) {
    e.kind = SvgKind::Defs;
    e.name = p->name;
  } else if (const auto *p = dynamic_cast<const GradientProps *>(&props)) {
    bool radial = dynamic_cast<const RadialGradientProps *>(&props) != nullptr;
    e.kind = radial ? SvgKind::RadialGradient : SvgKind::LinearGradient;
    e.name = p->name;
    if (radial) {
      lengths(e, {{"cx", &p->cx}, {"cy", &p->cy}, {"rx", &p->rx}, {"ry", &p->ry}, {"fx", &p->fx}, {"fy", &p->fy}});
    } else {
      lengths(e, {{"x1", &p->x1}, {"y1", &p->y1}, {"x2", &p->x2}, {"y2", &p->y2}});
    }
    stops(e, *p);
  } else if (const auto *p = dynamic_cast<const RNSVGClipPathProps *>(&props)) {
    e.kind = SvgKind::ClipPath;
    common(e, *p);
  } else if (const auto *p = dynamic_cast<const RNSVGMaskProps *>(&props)) {
    e.kind = SvgKind::Mask;
    common(e, *p);
    lengths(e, {{"x", &p->x}, {"y", &p->y}, {"width", &p->width}, {"height", &p->height}});
    e.units = p->maskUnits;
    e.contentUnits = p->maskContentUnits;
    e.maskType = p->maskType;
  } else if (const auto *p = dynamic_cast<const RNSVGSymbolProps *>(&props)) {
    e.kind = SvgKind::Symbol;
    common(e, *p);
    e.minX = p->minX;
    e.minY = p->minY;
    e.vbWidth = p->vbWidth;
    e.vbHeight = p->vbHeight;
    e.align = p->align;
    e.meetOrSlice = p->meetOrSlice;
  } else if (const auto *p = dynamic_cast<const RNSVGImageProps *>(&props)) {
    e.kind = SvgKind::Image;
    common(e, *p);
    lengths(e, {{"x", &p->x}, {"y", &p->y}, {"width", &p->width}, {"height", &p->height}});
    e.uri = p->src.uri;
    e.align = p->align;
    e.meetOrSlice = p->meetOrSlice;
  } else if (const auto *p = dynamic_cast<const RNSVGTextProps *>(&props)) {
    e.kind = SvgKind::Text;
    common(e, *p);
    text(e, *p);
  } else if (const auto *p = dynamic_cast<const RNSVGTSpanProps *>(&props)) {
    e.kind = SvgKind::TSpan;
    common(e, *p);
    text(e, *p);
    e.content = p->content;
  } else {
    return std::nullopt;
  }
  return e;
}

} // namespace

void installGlue_rnsvg() {
  auto &glue = libraryGlue();
  glue.svgElement = svgElement;
  glue.components.push_back(concreteComponentDescriptorProvider<RNSVGSvgViewComponentDescriptor>());
  glue.components.push_back(concreteComponentDescriptorProvider<ConcreteComponentDescriptor<LinearGradientShadowNode>>());
  glue.components.push_back(concreteComponentDescriptorProvider<ConcreteComponentDescriptor<RadialGradientShadowNode>>());
}

} // namespace ngn
