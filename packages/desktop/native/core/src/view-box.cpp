#include "ngn/view-box.h"

#include <react/renderer/graphics/BackgroundImage.h>

#include <algorithm>
#include <cmath>
#include <numbers>

using namespace facebook::react;

namespace ngn {

namespace {

// A quarter ellipse as one cubic: the control points' distance along each tangent.
constexpr double kKappa = 0.5522847498307936;

std::optional<uint32_t> argbOf(const SharedColor &color) {
  if (!color) {
    return std::nullopt;
  }
  auto c = colorComponentsFromColor(color);
  auto channel = [](float v) { return static_cast<uint32_t>(std::lround(std::clamp(v, 0.0f, 1.0f) * 255)); };
  return channel(c.alpha) << 24 | channel(c.red) << 16 | channel(c.green) << 8 | channel(c.blue);
}

bool visible(const std::optional<uint32_t> &argb) {
  return argb && (*argb >> 24) != 0;
}

CornerRadii cornerRadiiOf(const BorderRadii &r) {
  return {
      .topLeft = {r.topLeft.horizontal, r.topLeft.vertical},
      .topRight = {r.topRight.horizontal, r.topRight.vertical},
      .bottomRight = {r.bottomRight.horizontal, r.bottomRight.vertical},
      .bottomLeft = {r.bottomLeft.horizontal, r.bottomLeft.vertical},
  };
}

EdgeWidths widthsOf(const BorderWidths &w) {
  return {.top = w.top, .right = w.right, .bottom = w.bottom, .left = w.left};
}

SvgRect inset(const SvgRect &r, const EdgeWidths &w) {
  return {r.x + w.left, r.y + w.top, std::max(0.0, r.width - w.left - w.right), std::max(0.0, r.height - w.top - w.bottom)};
}

SvgPath rectPath(const SvgRect &r) {
  return roundedRect(r, {});
}

void append(SvgPath &to, const SvgPath &from) {
  to.segments.insert(to.segments.end(), from.segments.begin(), from.segments.end());
}

// Where the line from `from` to `to` crosses the ellipse in `bounds`: the crossing nearer the
// ellipse's start (`second` false) or the other one, as RCTEllipseGetIntersectionsWithLine.
std::optional<std::pair<double, double>> ellipseCrossing(const SvgRect &bounds, double fx, double fy, double tx, double ty, bool second) {
  double cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  fx -= cx;
  fy -= cy;
  tx -= cx;
  ty -= cy;
  double m = (ty - fy) / (tx - fx);
  double a = bounds.width / 2, b = bounds.height / 2;
  double c = fy - m * fx;
  double A = b * b + a * a * m * m;
  double B = 2 * a * a * c * m;
  double D = std::sqrt((a * a * (b * b - c * c)) / A + std::pow(B / (2 * A), 2));
  double x = -B / (2 * A) + (second ? -D : D);
  double y = m * x + c;
  if (std::isnan(x) || std::isnan(y)) {
    return std::nullopt;
  }
  return std::pair{x + cx, y + cy};
}

using XY = std::pair<double, double>;

SvgPath polygon(std::initializer_list<XY> points) {
  SvgPath path;
  bool first = true;
  for (const auto &[x, y] : points) {
    first ? path.moveTo(x, y) : path.lineTo(x, y);
    first = false;
  }
  path.close();
  return path;
}

// The four sides' trapezoids, as RCTGetSolidBorderImage cuts them: from the box's corners to
// where the line from each corner meets the padding box's corner, or its curve.
void drawSides(const SvgRect &box, const EdgeWidths &w, const CornerRadii &radii, const std::optional<uint32_t> colors[4], SvgCanvas &canvas) {
  double W = box.width, H = box.height;
  auto inner = innerRadii(radii, w);
  XY topLeft{w.left, w.top};
  if (inner.topLeft.x > 0 && inner.topLeft.y > 0) {
    if (auto p = ellipseCrossing({w.left, w.top, 2 * inner.topLeft.x, 2 * inner.topLeft.y}, 0, 0, w.left, w.top, true)) {
      topLeft = *p;
    }
  }
  XY bottomLeft{w.left, H - w.bottom};
  if (inner.bottomLeft.x > 0 && inner.bottomLeft.y > 0) {
    SvgRect e{w.left, H - w.bottom - 2 * inner.bottomLeft.y, 2 * inner.bottomLeft.x, 2 * inner.bottomLeft.y};
    if (auto p = ellipseCrossing(e, 0, H, w.left, H - w.bottom, true)) {
      bottomLeft = *p;
    }
  }
  XY topRight{W - w.right, w.top};
  if (inner.topRight.x > 0 && inner.topRight.y > 0) {
    SvgRect e{W - w.right - 2 * inner.topRight.x, w.top, 2 * inner.topRight.x, 2 * inner.topRight.y};
    if (auto p = ellipseCrossing(e, W, 0, W - w.right, w.top, false)) {
      topRight = *p;
    }
  }
  XY bottomRight{W - w.right, H - w.bottom};
  if (inner.bottomRight.x > 0 && inner.bottomRight.y > 0) {
    SvgRect e{W - w.right - 2 * inner.bottomRight.x, H - w.bottom - 2 * inner.bottomRight.y, 2 * inner.bottomRight.x, 2 * inner.bottomRight.y};
    if (auto p = ellipseCrossing(e, W, H, W - w.right, H - w.bottom, false)) {
      bottomRight = *p;
    }
  }

  // React Native iOS's order: right, bottom, left, top. Sides of one colour share a path.
  struct Side {
    double width;
    const std::optional<uint32_t> &color;
    SvgPath shape;
  };
  Side sides[] = {
      {w.right, colors[1], polygon({{W, 0}, topRight, bottomRight, {W, H}})},
      {w.bottom, colors[2], polygon({{0, H}, bottomLeft, bottomRight, {W, H}})},
      {w.left, colors[3], polygon({{0, 0}, topLeft, bottomLeft, {0, H}})},
      {w.top, colors[0], polygon({{0, 0}, topLeft, topRight, {W, 0}})},
  };
  std::vector<std::pair<uint32_t, SvgPath>> groups;
  for (auto &side : sides) {
    if (side.width <= 0 || !visible(side.color)) {
      continue;
    }
    auto group = std::find_if(groups.begin(), groups.end(), [&](const auto &g) { return g.first == *side.color; });
    if (group == groups.end()) {
      groups.emplace_back(*side.color, side.shape);
    } else {
      append(group->second, side.shape);
    }
  }
  for (const auto &[argb, path] : groups) {
    canvas.fill(path, false, SvgPaint{.argb = argb});
  }
}

void drawBorder(const SvgRect &box, const BorderMetrics &metrics, const CornerRadii &radii, SvgCanvas &canvas) {
  auto w = widthsOf(metrics.borderWidths);
  const auto &c = metrics.borderColors;
  std::optional<uint32_t> colors[4] = {argbOf(c.top), argbOf(c.right), argbOf(c.bottom), argbOf(c.left)};
  double widths[4] = {w.top, w.right, w.bottom, w.left};
  std::optional<uint32_t> only;
  bool oneColor = true, any = false;
  for (int i = 0; i < 4; i++) {
    if (widths[i] <= 0 || !visible(colors[i])) {
      continue;
    }
    any = true;
    if (only && *only != *colors[i]) {
      oneColor = false;
    }
    only = colors[i];
  }
  if (!any) {
    return;
  }

  auto style = metrics.borderStyles.left;
  if (style == BorderStyle::Dashed || style == BorderStyle::Dotted) {
    // One colour, stroked along the middle of the widest side, as React Native iOS draws it.
    if (!oneColor) {
      return;
    }
    double line = *std::max_element(std::begin(widths), std::end(widths));
    SvgRect middle{box.x + line / 2, box.y + line / 2, box.width - line, box.height - line};
    bool uniform = metrics.borderWidths.isUniform();
    if (!uniform) {
      canvas.save();
      auto ring = rectPath(box);
      append(ring, roundedRect(inset(box, w), innerRadii(radii, w)));
      canvas.clip(ring, true);
    }
    double dash = (style == BorderStyle::Dashed ? 3 : 1) * line;
    canvas.stroke(roundedRect(middle, radii), SvgStroke{.width = line, .dashes = {dash, dash}}, SvgPaint{.argb = *only});
    if (!uniform) {
      canvas.restore();
    }
    return;
  }

  auto ring = roundedRect(box, radii);
  append(ring, roundedRect(inset(box, w), innerRadii(radii, w)));
  if (oneColor) {
    canvas.fill(ring, true, SvgPaint{.argb = *only});
    return;
  }
  canvas.save();
  canvas.clip(ring, true);
  drawSides(box, w, radii, colors, canvas);
  canvas.restore();
}

// Both points of a gradient line, from React Native iOS's getPointsFromAngle (Chromium's): through
// the centre, long enough that the corners it points between take the first and last colours.
std::pair<XY, XY> gradientLine(double angle, double w, double h) {
  angle = std::fmod(angle, 360.0);
  if (angle < 0) {
    angle += 360;
  }
  if (angle == 0) {
    return {{0, h}, {0, 0}};
  }
  if (angle == 90) {
    return {{0, 0}, {w, 0}};
  }
  if (angle == 180) {
    return {{0, 0}, {0, h}};
  }
  if (angle == 270) {
    return {{w, 0}, {0, 0}};
  }
  double slope = std::tan((90 - angle) * std::numbers::pi / 180);
  double perpendicular = -1 / slope;
  double hw = w / 2, hh = h / 2;
  XY corner = angle < 90 ? XY{hw, hh} : angle < 180 ? XY{hw, -hh} : angle < 270 ? XY{-hw, -hh} : XY{-hw, hh};
  double c = corner.second - perpendicular * corner.first;
  double x = c / (slope - perpendicular);
  double y = perpendicular * x + c;
  return {{hw - x, hh + y}, {hw + x, hh - y}};
}

double keywordAngle(GradientKeyword keyword, double w, double h) {
  double deg = 180 / std::numbers::pi;
  switch (keyword) {
    case GradientKeyword::ToTopRight:
      return 90 - std::atan(w / h) * deg;
    case GradientKeyword::ToBottomRight:
      return std::atan(w / h) * deg + 90;
    case GradientKeyword::ToTopLeft:
      return std::atan(w / h) * deg + 270;
    case GradientKeyword::ToBottomLeft:
      return std::atan(h / w) * deg + 180;
  }
  return 180;
}

uint32_t mix(uint32_t from, uint32_t to, double t) {
  uint32_t out = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    double a = (from >> shift) & 0xff, b = (to >> shift) & 0xff;
    out |= static_cast<uint32_t>(std::lround(a + (b - a) * t)) << shift;
  }
  return out;
}

struct Stop {
  std::optional<uint32_t> color;
  double position{0};
};

// React Native's processColorTransitionHints: a hint between two stops is replaced by nine stops
// on the curve that puts the colours' midpoint at the hint.
std::vector<Stop> expandHints(const std::vector<Stop> &original) {
  std::vector<Stop> stops = original;
  int offset = 0;
  for (size_t i = 1; i + 1 < original.size(); ++i) {
    if (original[i].color) {
      continue;
    }
    size_t x = i + offset;
    double left = stops[x - 1].position, right = stops[x + 1].position, at = stops[x].position;
    double leftDist = at - left, rightDist = right - at, total = right - left;
    auto leftColor = stops[x - 1].color.value_or(0), rightColor = stops[x + 1].color.value_or(0);
    if (std::abs(leftDist - rightDist) < 1e-6) {
      stops.erase(stops.begin() + x);
      --offset;
      continue;
    }
    if (std::abs(leftDist) < 1e-6) {
      stops[x].color = rightColor;
      continue;
    }
    if (std::abs(rightDist) < 1e-6) {
      stops[x].color = leftColor;
      continue;
    }
    std::vector<Stop> added;
    if (leftDist > rightDist) {
      for (int y = 0; y < 7; ++y) {
        added.push_back({{}, left + leftDist * ((7.0 + y) / 13.0)});
      }
      added.push_back({{}, at + rightDist / 3.0});
      added.push_back({{}, at + rightDist * 2.0 / 3.0});
    } else {
      added.push_back({{}, left + leftDist / 3.0});
      added.push_back({{}, left + leftDist * 2.0 / 3.0});
      for (int y = 0; y < 7; ++y) {
        added.push_back({{}, at + rightDist * (y / 13.0)});
      }
    }
    double ratio = std::log(0.5) / std::log(leftDist / total);
    for (auto &stop : added) {
      double weight = std::pow((stop.position - left) / total, ratio);
      stop.color = std::isfinite(weight) ? mix(leftColor, rightColor, weight) : leftColor;
    }
    stops.erase(stops.begin() + x);
    stops.insert(stops.begin() + x, added.begin(), added.end());
    offset += 8;
  }
  return stops;
}

// Stops that reach before 0 or past 1 move the gradient's ends out to them; nothing is cut off.
// Answers the start and end along the old line (0 and 1 when nothing moves).
std::pair<double, double> spanOf(std::vector<std::pair<double, uint32_t>> &stops, bool allowBefore) {
  if (stops.empty()) {
    return {0, 1};
  }
  double from = allowBefore ? std::min(0.0, stops.front().first) : 0.0;
  double to = std::max(1.0, stops.back().first);
  if (from == 0 && to == 1) {
    return {0, 1};
  }
  for (auto &stop : stops) {
    stop.first = (std::max(stop.first, from) - from) / (to - from);
  }
  return {from, to};
}

// One axis of a background image's tiles, React Native iOS's replicator layer as positions.
std::vector<double> tileStarts(double areaStart, double areaSize, double item, double placed, BackgroundRepeatStyle repeat, double paintSize) {
  if (item <= 0 || repeat == BackgroundRepeatStyle::NoRepeat) {
    return {placed};
  }
  double step = item;
  double start = placed;
  if (repeat == BackgroundRepeatStyle::Space) {
    double count = std::floor(areaSize / item);
    if (count <= 1) {
      return {placed};
    }
    step = item + (areaSize - count * item) / (count - 1);
    start = areaStart;
  }
  double before = std::ceil(start / step);
  std::vector<double> out;
  for (double x = start - before * step; x < paintSize && out.size() < 4096; x += step) {
    if (x + item > 0) {
      out.push_back(x);
    }
  }
  return out;
}

double resolve(const ValueUnit &v, double of) {
  return v.unit == UnitType::Percent ? v.value * of / 100 : v.unit == UnitType::Point ? v.value : 0;
}

} // namespace

bool CornerRadii::circular() const {
  auto same = [&](const Corner &c) { return c.x == topLeft.x && c.y == topLeft.x; };
  return same(topLeft) && same(topRight) && same(bottomRight) && same(bottomLeft);
}

CornerRadii innerRadii(const CornerRadii &r, const EdgeWidths &w) {
  auto less = [](const CornerRadii::Corner &c, double x, double y) {
    return CornerRadii::Corner{std::max(0.0, c.x - x), std::max(0.0, c.y - y)};
  };
  return {
      .topLeft = less(r.topLeft, w.left, w.top),
      .topRight = less(r.topRight, w.right, w.top),
      .bottomRight = less(r.bottomRight, w.right, w.bottom),
      .bottomLeft = less(r.bottomLeft, w.left, w.bottom),
  };
}

CornerRadii spreadRadii(const CornerRadii &r, double spread) {
  // https://drafts.csswg.org/css-backgrounds/#shadow-shape, as RCTBoxShadow adjusts a radius.
  auto adjust = [spread](double radius) {
    double by = spread;
    if (radius < std::abs(spread)) {
      by *= 1 + std::pow(radius / std::abs(spread) - 1, 3);
    }
    return std::max(radius + by, 0.0);
  };
  auto corner = [&](const CornerRadii::Corner &c) { return CornerRadii::Corner{adjust(c.x), adjust(c.y)}; };
  return {corner(r.topLeft), corner(r.topRight), corner(r.bottomRight), corner(r.bottomLeft)};
}

SvgPath roundedRect(const SvgRect &rect, const CornerRadii &radii, bool reversed) {
  double minX = rect.x, minY = rect.y, maxX = rect.x + rect.width, maxY = rect.y + rect.height;
  double w = rect.width, h = rect.height;
  // RCTPathCreateWithRoundedRect's limits: each radius within what the opposite corner leaves.
  auto limit = [](double r, double side, double other) { return std::max(0.0, std::min(r, side - other)); };
  auto corner = [&](const CornerRadii::Corner &c, const CornerRadii::Corner &across, const CornerRadii::Corner &down) {
    CornerRadii::Corner out{limit(c.x, w, across.x), limit(c.y, h, down.y)};
    return out.x > 0 && out.y > 0 ? out : CornerRadii::Corner{};
  };
  auto tl = corner(radii.topLeft, radii.topRight, radii.bottomLeft);
  auto tr = corner(radii.topRight, radii.topLeft, radii.bottomRight);
  auto br = corner(radii.bottomRight, radii.bottomLeft, radii.topRight);
  auto bl = corner(radii.bottomLeft, radii.bottomRight, radii.topLeft);

  SvgPath path;
  double cx = 0, cy = 0;
  auto move = [&](double x, double y) {
    path.moveTo(x, y);
    cx = x;
    cy = y;
  };
  auto line = [&](double x, double y) {
    if (x != cx || y != cy) {
      path.lineTo(x, y);
      cx = x;
      cy = y;
    }
  };
  // A quarter ellipse from the current point to (x, y), bulging towards the corner (kx, ky).
  auto arc = [&](double kx, double ky, double x, double y) {
    if (x == cx && y == cy) {
      return;
    }
    path.cubicTo(cx + (kx - cx) * kKappa, cy + (ky - cy) * kKappa, x + (kx - x) * kKappa, y + (ky - y) * kKappa, x, y);
    cx = x;
    cy = y;
  };
  if (!reversed) {
    move(minX + tl.x, minY);
    line(maxX - tr.x, minY);
    arc(maxX, minY, maxX, minY + tr.y);
    line(maxX, maxY - br.y);
    arc(maxX, maxY, maxX - br.x, maxY);
    line(minX + bl.x, maxY);
    arc(minX, maxY, minX, maxY - bl.y);
    line(minX, minY + tl.y);
    arc(minX, minY, minX + tl.x, minY);
  } else {
    move(minX + tl.x, minY);
    arc(minX, minY, minX, minY + tl.y);
    line(minX, maxY - bl.y);
    arc(minX, maxY, minX + bl.x, maxY);
    line(maxX - br.x, maxY);
    arc(maxX, maxY, maxX, maxY - br.y);
    line(maxX, minY + tr.y);
    arc(maxX, minY, maxX - tr.x, minY);
    line(minX + tl.x, minY);
  }
  path.close();
  return path;
}

std::vector<std::pair<double, uint32_t>> gradientStops(const std::vector<ColorStop> &colorStops, double lineLength) {
  if (colorStops.empty()) {
    return {};
  }
  auto positionOf = [&](const ValueUnit &p) -> std::optional<double> {
    if (p.unit == UnitType::Point) {
      return lineLength > 0 ? p.value / lineLength : 0.0;
    }
    if (p.unit == UnitType::Percent) {
      return p.value / 100.0;
    }
    return std::nullopt;
  };
  // React Native's getFixedColorStops: the first and last default to the ends, a stop is never
  // before the one before it, and the missing ones between share the space evenly.
  std::vector<std::optional<double>> positions(colorStops.size());
  double maxSoFar = positionOf(colorStops[0].position).value_or(0.0);
  for (size_t i = 0; i < colorStops.size(); i++) {
    auto p = positionOf(colorStops[i].position);
    if (!p) {
      if (i == 0) {
        p = 0.0;
      } else if (i == colorStops.size() - 1) {
        p = 1.0;
      }
    }
    if (p) {
      p = std::max(*p, maxSoFar);
      maxSoFar = *p;
    }
    positions[i] = p;
  }
  size_t lastDefined = 0;
  for (size_t i = 1; i < positions.size(); i++) {
    if (!positions[i]) {
      continue;
    }
    size_t missing = i - lastDefined - 1;
    double from = *positions[lastDefined];
    for (size_t j = 1; j <= missing; j++) {
      positions[lastDefined + j] = from + (*positions[i] - from) * j / (missing + 1);
    }
    lastDefined = i;
  }
  std::vector<Stop> stops;
  for (size_t i = 0; i < colorStops.size(); i++) {
    stops.push_back({argbOf(colorStops[i].color), positions[i].value_or(0)});
  }
  std::vector<std::pair<double, uint32_t>> out;
  for (const auto &stop : expandHints(stops)) {
    out.emplace_back(stop.position, stop.color.value_or(0));
  }
  return out;
}

SvgGradient linearGradient(const LinearGradient &gradient, double width, double height) {
  double angle = std::holds_alternative<Float>(gradient.direction)
      ? std::get<Float>(gradient.direction)
      : keywordAngle(std::get<GradientKeyword>(gradient.direction), width, height);
  auto [start, end] = gradientLine(angle, width, height);
  double dx = end.first - start.first, dy = end.second - start.second;
  SvgGradient out;
  out.stops = gradientStops(gradient.colorStops, std::hypot(dx, dy));
  auto [from, to] = spanOf(out.stops, true);
  out.x1 = start.first + dx * from;
  out.y1 = start.second + dy * from;
  out.x2 = start.first + dx * to;
  out.y2 = start.second + dy * to;
  return out;
}

std::optional<SvgGradient> radialGradient(const RadialGradient &gradient, double width, double height) {
  double cx = width / 2, cy = height / 2;
  const auto &p = gradient.position;
  if (p.top) {
    cy = resolve(*p.top, height);
  } else if (p.bottom) {
    cy = height - resolve(*p.bottom, height);
  }
  if (p.left) {
    cx = resolve(*p.left, width);
  } else if (p.right) {
    cx = width - resolve(*p.right, width);
  }
  bool circle = gradient.shape == RadialGradientShape::Circle;
  using Keyword = RadialGradientSize::SizeKeyword;
  auto toSide = [&](bool closest) {
    double rx = closest ? std::min(cx, width - cx) : std::max(cx, width - cx);
    double ry = closest ? std::min(cy, height - cy) : std::max(cy, height - cy);
    if (circle) {
      double r = closest ? std::min(rx, ry) : std::max(rx, ry);
      return XY{r, r};
    }
    return XY{rx, ry};
  };
  auto toCorner = [&](bool closest) {
    XY corners[] = {{0, 0}, {width, 0}, {width, height}, {0, height}};
    XY best = corners[0];
    double distance = std::hypot(cx, cy);
    for (const auto &c : corners) {
      double d = std::hypot(cx - c.first, cy - c.second);
      if (closest ? d < distance : d > distance) {
        distance = d;
        best = c;
      }
    }
    if (circle) {
      return XY{distance, distance};
    }
    // The ellipse through that corner with the proportions of the matching side ellipse.
    auto side = toSide(closest);
    double ratio = side.first / side.second;
    if (ratio == 0 || !std::isfinite(ratio)) {
      return XY{0, 0};
    }
    double ox = best.first - cx, oy = best.second - cy;
    double a = std::sqrt(ox * ox + oy * oy * ratio * ratio);
    return XY{a, a / ratio};
  };
  XY radius;
  if (const auto *d = std::get_if<RadialGradientSize::Dimensions>(&gradient.size.value)) {
    radius = {resolve(d->x, width), resolve(d->y, height)};
    if (circle) {
      radius.first = radius.second = std::max(radius.first, radius.second);
    }
  } else {
    auto keyword = std::get<Keyword>(gradient.size.value);
    radius = keyword == Keyword::ClosestSide ? toSide(true)
        : keyword == Keyword::FarthestSide   ? toSide(false)
        : keyword == Keyword::ClosestCorner  ? toCorner(true)
                                             : toCorner(false);
  }
  auto [rx, ry] = radius;
  if (!(rx > 0) || !(ry > 0)) {
    return std::nullopt;
  }
  SvgGradient out;
  out.radial = true;
  // Lengths along the gradient ray, which runs across.
  out.stops = gradientStops(gradient.colorStops, rx);
  auto [from, to] = spanOf(out.stops, false);
  out.r = rx * to;
  out.transform = SvgMatrix::translate(cx, cy) * SvgMatrix::scale(1, ry / rx);
  return out;
}

std::vector<SvgRect> backgroundTiles(
    const SvgRect &area,
    const SvgRect &painting,
    const BackgroundSize &size,
    const BackgroundPosition &position,
    const BackgroundRepeat &repeat) {
  if (area.width <= 0 || area.height <= 0 || painting.width <= 0 || painting.height <= 0) {
    return {};
  }
  double w = area.width, h = area.height;
  if (const auto *lengths = std::get_if<BackgroundSizeLengthPercentage>(&size)) {
    if (const auto *x = std::get_if<ValueUnit>(&lengths->x)) {
      w = resolve(*x, area.width);
    }
    if (const auto *y = std::get_if<ValueUnit>(&lengths->y)) {
      h = resolve(*y, area.height);
    }
  }
  auto round = [](double item, double of) {
    if (item > 0 && std::fmod(of, item) != 0) {
      double divisor = std::round(of / item);
      if (divisor > 0) {
        return of / divisor;
      }
    }
    return item;
  };
  if (repeat.x == BackgroundRepeatStyle::Round) {
    w = round(w, area.width);
  }
  if (repeat.y == BackgroundRepeatStyle::Round) {
    h = round(h, area.height);
  }
  if (w <= 0 || h <= 0) {
    return {};
  }
  double x = area.x, y = area.y;
  if (position.top) {
    y += resolve(*position.top, area.height - h);
  } else if (position.bottom) {
    y += area.height - h - resolve(*position.bottom, area.height - h);
  }
  if (position.left) {
    x += resolve(*position.left, area.width - w);
  } else if (position.right) {
    x += area.width - w - resolve(*position.right, area.width - w);
  }
  auto xs = tileStarts(area.x, area.width, w, x, repeat.x, painting.width);
  auto ys = tileStarts(area.y, area.height, h, y, repeat.y, painting.height);
  std::vector<SvgRect> tiles;
  for (double ty : ys) {
    for (double tx : xs) {
      tiles.push_back({tx, ty, w, h});
    }
  }
  return tiles;
}

ViewBox viewBox(const ViewProps &props, const LayoutMetrics &layout) {
  ViewBox box;
  auto metrics = props.resolveBorderMetrics(layout);
  auto radii = cornerRadiiOf(metrics.borderRadii);
  auto widths = widthsOf(metrics.borderWidths);
  bool clips = props.yogaStyle.overflow() != facebook::yoga::Overflow::Visible;
  auto borderColor = argbOf(metrics.borderColors.left);
  bool circular = radii.circular();
  // RCTViewComponentView's useCoreAnimationBorderRendering.
  box.layerDrawn = metrics.borderColors.isUniform() && metrics.borderWidths.isUniform() && metrics.borderStyles.isUniform() &&
      metrics.borderStyles.left == BorderStyle::Solid && circular &&
      (widths.left == 0 || clips || (borderColor && (*borderColor >> 24) == 0));
  box.cornerRadius = circular ? radii.topLeft.x : 0;
  if (box.layerDrawn) {
    box.background = argbOf(props.backgroundColor);
    box.borderWidth = widths.left;
    box.borderColor = borderColor;
  }
  box.drawn = !box.layerDrawn || !props.backgroundImage.empty();
  if (clips && !circular) {
    box.clip = roundedRect({0, 0, layout.frame.size.width, layout.frame.size.height}, radii);
  }

  SvgRect bounds{0, 0, layout.frame.size.width, layout.frame.size.height};
  for (auto it = props.boxShadow.rbegin(); it != props.boxShadow.rend(); ++it) {
    const auto &shadow = *it;
    BoxShadowLayer layer;
    layer.inset = shadow.inset;
    layer.argb = argbOf(shadow.color).value_or(0xff000000);
    layer.radius = shadow.blurRadius / 2;
    if (!shadow.inset) {
      SvgRect cast{
          bounds.x - shadow.spreadDistance + shadow.offsetX,
          bounds.y - shadow.spreadDistance + shadow.offsetY,
          bounds.width + 2 * shadow.spreadDistance,
          bounds.height + 2 * shadow.spreadDistance};
      auto castRadii = spreadRadii(radii, shadow.spreadDistance);
      layer.shadowPath = roundedRect(cast, castRadii);
      layer.mask = roundedRect(bounds, radii);
      double pad = 2 * (shadow.blurRadius + 1);
      append(layer.mask, roundedRect({cast.x - pad, cast.y - pad, cast.width + 2 * pad, cast.height + 2 * pad}, castRadii));
      layer.maskEvenOdd = true;
    } else {
      auto padding = inset(bounds, widths);
      double blur = shadow.blurRadius;
      layer.shadowPath = rectPath({padding.x - blur, padding.y - blur, padding.width + 2 * blur, padding.height + 2 * blur});
      SvgRect clear{
          padding.x + shadow.offsetX + shadow.spreadDistance,
          padding.y + shadow.offsetY + shadow.spreadDistance,
          std::max(0.0, padding.width - 2 * shadow.spreadDistance),
          std::max(0.0, padding.height - 2 * shadow.spreadDistance)};
      append(layer.shadowPath, roundedRect(clear, innerRadii(spreadRadii(radii, -shadow.spreadDistance), widths), true));
      layer.mask = roundedRect(padding, innerRadii(radii, widths));
    }
    box.shadows.push_back(std::move(layer));
  }
  return box;
}

void drawViewBox(const ViewProps &props, const LayoutMetrics &layout, SvgCanvas &canvas) {
  auto box = viewBox(props, layout);
  if (!box.drawn) {
    return;
  }
  auto metrics = props.resolveBorderMetrics(layout);
  auto radii = cornerRadiiOf(metrics.borderRadii);
  auto widths = widthsOf(metrics.borderWidths);
  SvgRect bounds{0, 0, layout.frame.size.width, layout.frame.size.height};
  auto outer = roundedRect(bounds, radii);

  if (!box.layerDrawn) {
    auto background = argbOf(props.backgroundColor);
    if (visible(background)) {
      canvas.fill(outer, false, SvgPaint{.argb = *background});
    }
  }

  if (!props.backgroundImage.empty()) {
    // background-origin: padding-box; background-clip: border-box. The first image is on top.
    auto area = inset(bounds, widths);
    canvas.save();
    canvas.clip(outer, false);
    for (size_t i = props.backgroundImage.size(); i-- > 0;) {
      auto pick = [i](const auto &list, auto fallback) { return list.empty() ? fallback : list[i % list.size()]; };
      auto tiles = backgroundTiles(
          area,
          bounds,
          pick(props.backgroundSize, BackgroundSize{BackgroundSizeLengthPercentage{}}),
          pick(props.backgroundPosition, BackgroundPosition{}),
          pick(props.backgroundRepeat, BackgroundRepeat{}));
      if (tiles.empty()) {
        continue;
      }
      const auto &image = props.backgroundImage[i];
      double w = tiles[0].width, h = tiles[0].height;
      std::optional<SvgGradient> gradient = std::holds_alternative<LinearGradient>(image)
          ? std::optional{linearGradient(std::get<LinearGradient>(image), w, h)}
          : radialGradient(std::get<RadialGradient>(image), w, h);
      if (!gradient || gradient->stops.empty()) {
        continue;
      }
      for (const auto &tile : tiles) {
        SvgPaint paint;
        paint.gradient = *gradient;
        paint.gradient->transform = SvgMatrix::translate(tile.x, tile.y) * gradient->transform;
        canvas.fill(rectPath(tile), false, paint);
      }
    }
    canvas.restore();
  }

  if (!box.layerDrawn) {
    drawBorder(bounds, metrics, radii, canvas);
  }
}

} // namespace ngn
