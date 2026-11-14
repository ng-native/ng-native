#include "ngn/svg.h"

#include "ngn/library-glue.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <unordered_set>

namespace ngn {

// --- geometry ------------------------------------------------------------------------------------

SvgMatrix SvgMatrix::operator*(const SvgMatrix &m) const {
  return {
      a * m.a + c * m.b,
      b * m.a + d * m.b,
      a * m.c + c * m.d,
      b * m.c + d * m.d,
      a * m.e + c * m.f + e,
      b * m.e + d * m.f + f,
  };
}

std::pair<double, double> SvgMatrix::apply(double x, double y) const {
  return {a * x + c * y + e, b * x + d * y + f};
}

void SvgPath::moveTo(double x, double y) {
  segments.push_back({Op::Move, {x, y}});
}

void SvgPath::lineTo(double x, double y) {
  segments.push_back({Op::Line, {x, y}});
}

void SvgPath::cubicTo(double x1, double y1, double x2, double y2, double x, double y) {
  segments.push_back({Op::Cubic, {x1, y1, x2, y2, x, y}});
}

void SvgPath::close() {
  segments.push_back({Op::Close, {}});
}

void SvgPath::append(const SvgPath &other, const SvgMatrix &t) {
  for (auto s : other.segments) {
    int points = s.op == Op::Cubic ? 3 : s.op == Op::Close ? 0 : 1;
    for (int i = 0; i < points; ++i) {
      auto [x, y] = t.apply(s.points[i * 2], s.points[i * 2 + 1]);
      s.points[i * 2] = x;
      s.points[i * 2 + 1] = y;
    }
    segments.push_back(s);
  }
}

std::optional<SvgRect> SvgPath::bounds() const {
  bool any = false;
  double minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const auto &s : segments) {
    int points = s.op == Op::Cubic ? 3 : s.op == Op::Close ? 0 : 1;
    for (int i = 0; i < points; ++i) {
      double x = s.points[i * 2], y = s.points[i * 2 + 1];
      if (!any) {
        minX = maxX = x;
        minY = maxY = y;
        any = true;
      }
      minX = std::min(minX, x);
      maxX = std::max(maxX, x);
      minY = std::min(minY, y);
      maxY = std::max(maxY, y);
    }
  }
  if (!any) {
    return std::nullopt;
  }
  return SvgRect{minX, minY, maxX - minX, maxY - minY};
}

namespace {

constexpr double kPi = 3.14159265358979323846;

// Path data's numbers and flags, as SVG's grammar reads them.
class PathScanner {
 public:
  explicit PathScanner(const std::string &d) : d_(d) {}

  void skipSeparators() {
    while (i_ < d_.size() && (std::isspace(static_cast<unsigned char>(d_[i_])) || d_[i_] == ',')) {
      ++i_;
    }
  }

  bool atEnd() {
    skipSeparators();
    return i_ >= d_.size();
  }

  bool atNumber() {
    skipSeparators();
    if (i_ >= d_.size()) {
      return false;
    }
    char c = d_[i_];
    return std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+' || c == '.';
  }

  std::optional<char> command() {
    skipSeparators();
    if (i_ >= d_.size() || !std::isalpha(static_cast<unsigned char>(d_[i_]))) {
      return std::nullopt;
    }
    return d_[i_++];
  }

  std::optional<double> number() {
    skipSeparators();
    size_t start = i_;
    if (i_ < d_.size() && (d_[i_] == '-' || d_[i_] == '+')) {
      ++i_;
    }
    bool digits = false;
    while (i_ < d_.size() && std::isdigit(static_cast<unsigned char>(d_[i_]))) {
      ++i_;
      digits = true;
    }
    if (i_ < d_.size() && d_[i_] == '.') {
      ++i_;
      while (i_ < d_.size() && std::isdigit(static_cast<unsigned char>(d_[i_]))) {
        ++i_;
        digits = true;
      }
    }
    if (!digits) {
      i_ = start;
      return std::nullopt;
    }
    if (i_ < d_.size() && (d_[i_] == 'e' || d_[i_] == 'E')) {
      size_t mark = i_++;
      if (i_ < d_.size() && (d_[i_] == '-' || d_[i_] == '+')) {
        ++i_;
      }
      if (i_ < d_.size() && std::isdigit(static_cast<unsigned char>(d_[i_]))) {
        while (i_ < d_.size() && std::isdigit(static_cast<unsigned char>(d_[i_]))) {
          ++i_;
        }
      } else {
        i_ = mark;
      }
    }
    return std::strtod(d_.substr(start, i_ - start).c_str(), nullptr);
  }

  // An arc's flag: one character, 0 or 1, which may run into the next number.
  std::optional<bool> flag() {
    skipSeparators();
    if (i_ < d_.size() && (d_[i_] == '0' || d_[i_] == '1')) {
      return d_[i_++] == '1';
    }
    return std::nullopt;
  }

 private:
  const std::string &d_;
  size_t i_{0};
};

double angleBetween(double ux, double uy, double vx, double vy) {
  double sign = ux * vy - uy * vx < 0 ? -1 : 1;
  double dot = ux * vx + uy * vy;
  double length = std::hypot(ux, uy) * std::hypot(vx, vy);
  return sign * std::acos(std::clamp(dot / length, -1.0, 1.0));
}

// SVG's endpoint arc as cubics (SVG 1.1 implementation notes F.6.5 and F.6.6).
void arcTo(SvgPath &path, double x0, double y0, double rx, double ry, double degrees, bool large, bool sweep, double x, double y) {
  if (x0 == x && y0 == y) {
    return;
  }
  rx = std::fabs(rx);
  ry = std::fabs(ry);
  if (rx == 0 || ry == 0) {
    path.lineTo(x, y);
    return;
  }
  double phi = degrees * kPi / 180;
  double cosPhi = std::cos(phi), sinPhi = std::sin(phi);
  double dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  double x1p = cosPhi * dx + sinPhi * dy;
  double y1p = -sinPhi * dx + cosPhi * dy;
  double lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    double s = std::sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  double num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  double den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  double coef = (large == sweep ? -1 : 1) * std::sqrt(std::max(0.0, num / den));
  double cxp = coef * rx * y1p / ry;
  double cyp = -coef * ry * x1p / rx;
  double cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  double cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;
  double theta = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  double delta = angleBetween((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) {
    delta -= 2 * kPi;
  } else if (sweep && delta < 0) {
    delta += 2 * kPi;
  }
  int pieces = std::max(1, static_cast<int>(std::ceil(std::fabs(delta) / (kPi / 2) - 1e-9)));
  double step = delta / pieces;
  double k = 4.0 / 3.0 * std::tan(step / 4);
  auto point = [&](double angle) {
    double px = rx * std::cos(angle), py = ry * std::sin(angle);
    return std::pair<double, double>{cosPhi * px - sinPhi * py + cx, sinPhi * px + cosPhi * py + cy};
  };
  double angle = theta;
  for (int i = 0; i < pieces; ++i) {
    double next = angle + step;
    // The controls in the ellipse's own frame, then rotated and moved like its points.
    double ax = rx * std::cos(angle) - k * rx * std::sin(angle);
    double ay = ry * std::sin(angle) + k * ry * std::cos(angle);
    double bx = rx * std::cos(next) + k * rx * std::sin(next);
    double by = ry * std::sin(next) - k * ry * std::cos(next);
    bool last = i == pieces - 1;
    auto end = last ? std::pair<double, double>{x, y} : point(next);
    path.cubicTo(
        cosPhi * ax - sinPhi * ay + cx,
        sinPhi * ax + cosPhi * ay + cy,
        cosPhi * bx - sinPhi * by + cx,
        sinPhi * bx + cosPhi * by + cy,
        end.first,
        end.second);
    angle = next;
  }
}

} // namespace

SvgPath parseSvgPath(const std::string &d) {
  SvgPath path;
  PathScanner in(d);
  double x = 0, y = 0, startX = 0, startY = 0;
  // The last curve's second control point, for a smooth curve's reflection.
  double lastCx = 0, lastCy = 0;
  char lastCommand = 0;
  bool closed = false;
  std::optional<char> command;
  while (!in.atEnd()) {
    if (auto next = in.command()) {
      command = next;
    } else if (!command || !in.atNumber()) {
      break;
    } else if (*command == 'M') {
      command = 'L';
    } else if (*command == 'm') {
      command = 'l';
    }
    char c = *command;
    char upper = static_cast<char>(std::toupper(c));
    bool relative = c != upper;
    double ox = relative ? x : 0, oy = relative ? y : 0;
    if (path.empty() && upper != 'M') {
      break;
    }
    if (upper == 'Z') {
      path.close();
      x = startX;
      y = startY;
      closed = true;
      lastCommand = 'Z';
      continue;
    }
    // A drawing command right after a close starts a new subpath where the closed one started.
    if (closed && upper != 'M') {
      path.moveTo(x, y);
    }
    closed = false;
    auto n = [&]() { return in.number(); };
    bool ok = true;
    switch (upper) {
      case 'M': {
        auto px = n(), py = n();
        if (!px || !py) {
          ok = false;
          break;
        }
        // A relative move after a close starts from the closed subpath's start.
        x = ox + *px;
        y = oy + *py;
        startX = x;
        startY = y;
        path.moveTo(x, y);
        break;
      }
      case 'L': {
        auto px = n(), py = n();
        if (!px || !py) {
          ok = false;
          break;
        }
        x = ox + *px;
        y = oy + *py;
        path.lineTo(x, y);
        break;
      }
      case 'H': {
        auto px = n();
        if (!px) {
          ok = false;
          break;
        }
        x = ox + *px;
        path.lineTo(x, y);
        break;
      }
      case 'V': {
        auto py = n();
        if (!py) {
          ok = false;
          break;
        }
        y = oy + *py;
        path.lineTo(x, y);
        break;
      }
      case 'C':
      case 'S': {
        double x1, y1;
        if (upper == 'C') {
          auto a = n(), b = n();
          if (!a || !b) {
            ok = false;
            break;
          }
          x1 = ox + *a;
          y1 = oy + *b;
        } else {
          bool after = lastCommand == 'C' || lastCommand == 'S';
          x1 = after ? 2 * x - lastCx : x;
          y1 = after ? 2 * y - lastCy : y;
        }
        auto a = n(), b = n(), e = n(), f = n();
        if (!a || !b || !e || !f) {
          ok = false;
          break;
        }
        lastCx = ox + *a;
        lastCy = oy + *b;
        x = ox + *e;
        y = oy + *f;
        path.cubicTo(x1, y1, lastCx, lastCy, x, y);
        break;
      }
      case 'Q':
      case 'T': {
        double qx, qy;
        if (upper == 'Q') {
          auto a = n(), b = n();
          if (!a || !b) {
            ok = false;
            break;
          }
          qx = ox + *a;
          qy = oy + *b;
        } else {
          bool after = lastCommand == 'Q' || lastCommand == 'T';
          qx = after ? 2 * x - lastCx : x;
          qy = after ? 2 * y - lastCy : y;
        }
        auto e = n(), f = n();
        if (!e || !f) {
          ok = false;
          break;
        }
        double ex = ox + *e, ey = oy + *f;
        path.cubicTo(x + 2.0 / 3 * (qx - x), y + 2.0 / 3 * (qy - y), ex + 2.0 / 3 * (qx - ex), ey + 2.0 / 3 * (qy - ey), ex, ey);
        // A quadratic's control, which a smooth quadratic reflects.
        lastCx = qx;
        lastCy = qy;
        x = ex;
        y = ey;
        break;
      }
      case 'A': {
        auto rx = n(), ry = n(), rotation = n();
        auto large = in.flag();
        auto sweep = in.flag();
        auto ex = n(), ey = n();
        if (!rx || !ry || !rotation || !large || !sweep || !ex || !ey) {
          ok = false;
          break;
        }
        double tx = ox + *ex, ty = oy + *ey;
        arcTo(path, x, y, *rx, *ry, *rotation, *large, *sweep, tx, ty);
        x = tx;
        y = ty;
        break;
      }
      default:
        ok = false;
    }
    if (!ok) {
      break;
    }
    lastCommand = upper;
  }
  return path;
}

// --- props ---------------------------------------------------------------------------------------

SvgLength svgLength(const folly::dynamic &value) {
  if (value.isNumber()) {
    return {.value = value.asDouble(), .set = true};
  }
  if (!value.isString()) {
    return {};
  }
  const auto &text = value.getString();
  const char *begin = text.c_str();
  char *end = nullptr;
  double number = std::strtod(begin, &end);
  if (end == begin) {
    return {};
  }
  std::string unit(end);
  unit.erase(std::remove_if(unit.begin(), unit.end(), [](unsigned char c) { return std::isspace(c); }), unit.end());
  if (unit == "%") {
    return {.value = number, .unit = SvgLength::Unit::Percent, .set = true};
  }
  if (unit == "em") {
    return {.value = number, .unit = SvgLength::Unit::Em, .set = true};
  }
  // Absolute units at CSS's 96 to the inch, which is one user unit per px.
  static const std::map<std::string, double> absolute = {
      {"", 1}, {"px", 1}, {"pt", 4.0 / 3}, {"pc", 16}, {"in", 96}, {"cm", 96 / 2.54}, {"mm", 96 / 25.4}};
  auto found = absolute.find(unit);
  if (found == absolute.end()) {
    return {};
  }
  return {.value = number * found->second, .set = true};
}

std::vector<SvgLength> svgLengths(const folly::dynamic &value) {
  std::vector<SvgLength> out;
  if (value.isArray()) {
    for (const auto &item : value) {
      auto length = svgLength(item);
      if (length.set) {
        out.push_back(length);
      }
    }
  } else if (auto length = svgLength(value); length.set) {
    out.push_back(length);
  }
  return out;
}

SvgBrush svgBrush(const folly::dynamic &value) {
  if (value.isNumber()) {
    return {.type = SvgBrush::Type::Color, .argb = static_cast<uint32_t>(value.asInt())};
  }
  if (!value.isObject()) {
    return {};
  }
  auto type = value.getDefault("type", -1);
  int kind = type.isNumber() ? static_cast<int>(type.asInt()) : -1;
  if (kind == 0) {
    auto payload = value.getDefault("payload", nullptr);
    if (!payload.isNumber()) {
      return {.type = SvgBrush::Type::None};
    }
    return {.type = SvgBrush::Type::Color, .argb = static_cast<uint32_t>(static_cast<int64_t>(payload.asDouble()))};
  }
  if (kind == 1) {
    auto ref = value.getDefault("brushRef", "");
    return {.type = SvgBrush::Type::Ref, .ref = ref.isString() ? ref.getString() : ""};
  }
  if (kind == 2) {
    return {.type = SvgBrush::Type::CurrentColor};
  }
  return {.type = SvgBrush::Type::None};
}

SvgMatrix svgViewBoxTransform(const SvgRect &box, const std::string &align, int meetOrSlice, double width, double height) {
  if (box.width <= 0 || box.height <= 0) {
    return {};
  }
  double sx = width / box.width, sy = height / box.height;
  if (align == "none") {
    return SvgMatrix{sx, 0, 0, sy, -box.x * sx, -box.y * sy};
  }
  double s = meetOrSlice == 1 ? std::max(sx, sy) : std::min(sx, sy);
  std::string a = align.empty() ? "xMidYMid" : align;
  double tx = -box.x * s, ty = -box.y * s;
  double extraX = width - box.width * s, extraY = height - box.height * s;
  if (a.find("xMid") != std::string::npos) {
    tx += extraX / 2;
  } else if (a.find("xMax") != std::string::npos) {
    tx += extraX;
  }
  if (a.find("YMid") != std::string::npos) {
    ty += extraY / 2;
  } else if (a.find("YMax") != std::string::npos) {
    ty += extraY;
  }
  return SvgMatrix{s, 0, 0, s, tx, ty};
}

// --- drawing -------------------------------------------------------------------------------------

namespace {

bool isIdentity(const SvgMatrix &m) {
  return m == SvgMatrix{};
}

SvgPath rectPath(double x, double y, double w, double h) {
  SvgPath p;
  p.moveTo(x, y);
  p.lineTo(x + w, y);
  p.lineTo(x + w, y + h);
  p.lineTo(x, y + h);
  p.close();
  return p;
}

// The magic number for a quarter ellipse as a cubic.
constexpr double kQuarter = 0.5522847498307936;

SvgPath ellipsePath(double cx, double cy, double rx, double ry) {
  SvgPath p;
  double kx = rx * kQuarter, ky = ry * kQuarter;
  p.moveTo(cx + rx, cy);
  p.cubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
  p.cubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
  p.cubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
  p.cubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
  p.close();
  return p;
}

SvgPath roundedRectPath(double x, double y, double w, double h, double rx, double ry) {
  rx = std::min(rx, w / 2);
  ry = std::min(ry, h / 2);
  if (rx <= 0 || ry <= 0) {
    return rectPath(x, y, w, h);
  }
  double kx = rx * (1 - kQuarter), ky = ry * (1 - kQuarter);
  SvgPath p;
  p.moveTo(x + rx, y);
  p.lineTo(x + w - rx, y);
  p.cubicTo(x + w - kx, y, x + w, y + ky, x + w, y + ry);
  p.lineTo(x + w, y + h - ry);
  p.cubicTo(x + w, y + h - ky, x + w - kx, y + h, x + w - rx, y + h);
  p.lineTo(x + rx, y + h);
  p.cubicTo(x + kx, y + h, x, y + h - ky, x, y + h - ry);
  p.lineTo(x, y + ry);
  p.cubicTo(x, y + ky, x + kx, y, x + rx, y);
  p.close();
  return p;
}

std::optional<SvgRect> unite(std::optional<SvgRect> a, std::optional<SvgRect> b) {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  double minX = std::min(a->x, b->x), minY = std::min(a->y, b->y);
  double maxX = std::max(a->x + a->width, b->x + b->width), maxY = std::max(a->y + a->height, b->y + b->height);
  return SvgRect{minX, minY, maxX - minX, maxY - minY};
}

std::optional<SvgRect> transformed(std::optional<SvgRect> r, const SvgMatrix &m) {
  if (!r) {
    return r;
  }
  SvgPath corners = rectPath(r->x, r->y, r->width, r->height);
  SvgPath out;
  out.append(corners, m);
  return out.bounds();
}

bool listed(const std::vector<std::string> &list, const char *name) {
  return std::find(list.begin(), list.end(), name) != list.end();
}

// The presentation an element draws with, after inheritance.
struct Style {
  SvgBrush fill{.type = SvgBrush::Type::Color, .argb = 0xff000000};
  double fillOpacity{1};
  int fillRule{1};
  SvgBrush stroke{.type = SvgBrush::Type::None};
  double strokeOpacity{1};
  SvgLength strokeWidth{.value = 1, .set = true};
  int strokeLinecap{0};
  int strokeLinejoin{0};
  std::vector<SvgLength> strokeDasharray;
  double strokeDashoffset{0};
  double strokeMiterlimit{4};
  uint32_t color{0xff000000};
  double fontSize{12};
  std::string fontFamily;
  std::string fontWeight;
  // The attributes set somewhere above or on the element, which its children inherit.
  std::unordered_set<std::string> list;
};

class Renderer {
 public:
  Renderer(const SvgDocument &document, double width, double height, SvgCanvas &canvas)
      : document_(document), width_(width), height_(height), canvas_(canvas) {
    index(document.root);
  }

  void draw() {
    const auto &root = document_.root.element;
    double vw = root.bbWidth.set ? resolveIn(root.bbWidth, width_) : width_;
    double vh = root.bbHeight.set ? resolveIn(root.bbHeight, height_) : height_;
    canvas_.save();
    if (root.vbWidth > 0 && root.vbHeight > 0) {
      auto m = svgViewBoxTransform({root.minX, root.minY, root.vbWidth, root.vbHeight}, root.align, root.meetOrSlice, vw, vh);
      if (!isIdentity(m)) {
        canvas_.concat(m);
      }
      vw_ = root.vbWidth;
      vh_ = root.vbHeight;
    } else {
      vw_ = vw;
      vh_ = vh;
    }
    Style style;
    if (root.color) {
      style.color = *root.color;
    }
    for (const auto &child : document_.root.children) {
      drawNode(child, style);
    }
    canvas_.restore();
  }

 private:
  enum class Axis { X, Y, Other };

  void index(const SvgNode &node) {
    if (!node.element.name.empty()) {
      names_.emplace(node.element.name, &node);
    }
    for (const auto &child : node.children) {
      index(child);
    }
  }

  const SvgNode *named(const std::string &name, std::initializer_list<SvgKind> kinds = {}) const {
    auto found = names_.find(name);
    if (found == names_.end()) {
      return nullptr;
    }
    if (kinds.size() > 0 && std::find(kinds.begin(), kinds.end(), found->second->element.kind) == kinds.end()) {
      return nullptr;
    }
    return found->second;
  }

  static double resolveIn(const SvgLength &l, double base, double fontSize = 12) {
    switch (l.unit) {
      case SvgLength::Unit::Percent:
        return base * l.value / 100;
      case SvgLength::Unit::Em:
        return l.value * fontSize;
      default:
        return l.value;
    }
  }

  double resolve(const SvgLength &l, Axis axis, double fontSize = 12) const {
    double base = axis == Axis::X ? vw_ : axis == Axis::Y ? vh_ : std::sqrt((vw_ * vw_ + vh_ * vh_) / 2);
    return resolveIn(l, base, fontSize);
  }

  double length(const SvgElement &e, const char *name, Axis axis, double fallback = 0) const {
    auto found = e.lengths.find(name);
    return found == e.lengths.end() || !found->second.set ? fallback : resolve(found->second, axis);
  }

  bool has(const SvgElement &e, const char *name) const {
    auto found = e.lengths.find(name);
    return found != e.lengths.end() && found->second.set;
  }

  static Style merge(const Style &parent, const SvgElement &e) {
    Style s;
    s.color = e.color.value_or(parent.color);
    s.fontSize = parent.fontSize;
    s.fontFamily = e.fontFamily.empty() ? parent.fontFamily : e.fontFamily;
    s.fontWeight = e.fontWeight.empty() ? parent.fontWeight : e.fontWeight;
    if (e.fontSize.set) {
      s.fontSize = resolveIn(e.fontSize, parent.fontSize, parent.fontSize);
    }
    s.list = parent.list;
    for (const auto &name : e.propList) {
      s.list.insert(name);
    }
    // An attribute the element lists is its own; one it does not is its parent's where the parent
    // has it, else the element's own value as sent.
    auto take = [&](const char *name, auto &field, const auto &own, const auto &inherited) {
      field = !listed(e.propList, name) && parent.list.contains(name) ? inherited : own;
    };
    auto brush = [&](const SvgBrush &b, bool fill) {
      if (b.type != SvgBrush::Type::Unset) {
        return b;
      }
      // Null in propList is `none`; never sent is SVG's default, black for a fill.
      bool listedHere = listed(e.propList, fill ? "fill" : "stroke");
      if (fill && !listedHere) {
        return SvgBrush{.type = SvgBrush::Type::Color, .argb = 0xff000000};
      }
      return SvgBrush{.type = SvgBrush::Type::None};
    };
    take("fill", s.fill, brush(e.fill, true), parent.fill);
    take("fillOpacity", s.fillOpacity, e.fillOpacity, parent.fillOpacity);
    take("fillRule", s.fillRule, e.fillRule, parent.fillRule);
    take("stroke", s.stroke, brush(e.stroke, false), parent.stroke);
    take("strokeOpacity", s.strokeOpacity, e.strokeOpacity, parent.strokeOpacity);
    take("strokeWidth", s.strokeWidth, e.strokeWidth.set ? e.strokeWidth : SvgLength{.value = 1, .set = true}, parent.strokeWidth);
    take("strokeLinecap", s.strokeLinecap, e.strokeLinecap, parent.strokeLinecap);
    take("strokeLinejoin", s.strokeLinejoin, e.strokeLinejoin, parent.strokeLinejoin);
    take("strokeDasharray", s.strokeDasharray, e.strokeDasharray, parent.strokeDasharray);
    take("strokeDashoffset", s.strokeDashoffset, e.strokeDashoffset, parent.strokeDashoffset);
    take("strokeMiterlimit", s.strokeMiterlimit, e.strokeMiterlimit >= 1 ? e.strokeMiterlimit : 4.0, parent.strokeMiterlimit);
    return s;
  }

  std::optional<SvgPath> shape(const SvgElement &e) const {
    switch (e.kind) {
      case SvgKind::Path:
        return parseSvgPath(e.d);
      case SvgKind::Rect: {
        double x = length(e, "x", Axis::X), y = length(e, "y", Axis::Y);
        double w = length(e, "width", Axis::X), h = length(e, "height", Axis::Y);
        if (w <= 0 || h <= 0) {
          return SvgPath{};
        }
        bool hasRx = has(e, "rx"), hasRy = has(e, "ry");
        double rx = hasRx ? length(e, "rx", Axis::X) : 0, ry = hasRy ? length(e, "ry", Axis::Y) : 0;
        if (hasRx && !hasRy) {
          ry = rx;
        } else if (hasRy && !hasRx) {
          rx = ry;
        }
        return rx > 0 || ry > 0 ? roundedRectPath(x, y, w, h, rx, ry) : rectPath(x, y, w, h);
      }
      case SvgKind::Circle: {
        double r = length(e, "r", Axis::Other);
        if (r <= 0) {
          return SvgPath{};
        }
        return ellipsePath(length(e, "cx", Axis::X), length(e, "cy", Axis::Y), r, r);
      }
      case SvgKind::Ellipse: {
        double rx = length(e, "rx", Axis::X), ry = length(e, "ry", Axis::Y);
        if (rx <= 0 || ry <= 0) {
          return SvgPath{};
        }
        return ellipsePath(length(e, "cx", Axis::X), length(e, "cy", Axis::Y), rx, ry);
      }
      case SvgKind::Line: {
        SvgPath p;
        p.moveTo(length(e, "x1", Axis::X), length(e, "y1", Axis::Y));
        p.lineTo(length(e, "x2", Axis::X), length(e, "y2", Axis::Y));
        return p;
      }
      default:
        return std::nullopt;
    }
  }

  // What `node` covers in its own user space (before its own transform), for a gradient's or a
  // mask's objectBoundingBox.
  std::optional<SvgRect> bounds(const SvgNode &node) const {
    if (auto p = shape(node.element)) {
      return p->bounds();
    }
    if (node.element.kind != SvgKind::Group) {
      return std::nullopt;
    }
    std::optional<SvgRect> out;
    for (const auto &child : node.children) {
      auto b = bounds(child);
      out = unite(out, child.element.matrix ? transformed(b, *child.element.matrix) : b);
    }
    return out;
  }

  std::optional<SvgPaint> paint(const SvgBrush &brush, double opacity, const Style &style, const std::optional<SvgRect> &box) const {
    switch (brush.type) {
      case SvgBrush::Type::Color:
        return SvgPaint{.argb = brush.argb, .opacity = opacity};
      case SvgBrush::Type::CurrentColor:
        return SvgPaint{.argb = style.color, .opacity = opacity};
      case SvgBrush::Type::Ref: {
        const auto *node = named(brush.ref, {SvgKind::LinearGradient, SvgKind::RadialGradient});
        if (node == nullptr) {
          return std::nullopt;
        }
        return gradient(node->element, opacity, box);
      }
      default:
        return std::nullopt;
    }
  }

  std::optional<SvgPaint> gradient(const SvgElement &g, double opacity, const std::optional<SvgRect> &box) const {
    if (g.stops.empty()) {
      return std::nullopt;
    }
    if (g.stops.size() == 1) {
      return SvgPaint{.argb = g.stops[0].second, .opacity = opacity};
    }
    bool bounding = g.units == 0;
    if (bounding && (!box || box->width <= 0 || box->height <= 0)) {
      return std::nullopt;
    }
    auto at = [&](const char *name, Axis axis, double fallbackFraction) {
      auto found = g.lengths.find(name);
      if (found == g.lengths.end() || !found->second.set) {
        return bounding ? fallbackFraction : resolve({.value = fallbackFraction * 100, .unit = SvgLength::Unit::Percent}, axis);
      }
      const auto &l = found->second;
      if (bounding) {
        return l.unit == SvgLength::Unit::Percent ? l.value / 100 : l.value;
      }
      return resolve(l, axis);
    };
    SvgGradient out{.radial = g.kind == SvgKind::RadialGradient, .stops = g.stops};
    if (out.radial) {
      out.x1 = at("cx", Axis::X, 0.5);
      out.y1 = at("cy", Axis::Y, 0.5);
      out.r = at("rx", Axis::Other, 0.5);
      bool hasFx = g.lengths.contains("fx") && g.lengths.at("fx").set;
      bool hasFy = g.lengths.contains("fy") && g.lengths.at("fy").set;
      out.x2 = hasFx ? at("fx", Axis::X, 0.5) : out.x1;
      out.y2 = hasFy ? at("fy", Axis::Y, 0.5) : out.y1;
    } else {
      out.x1 = at("x1", Axis::X, 0);
      out.y1 = at("y1", Axis::Y, 0);
      out.x2 = at("x2", Axis::X, 1);
      out.y2 = at("y2", Axis::Y, 0);
    }
    SvgMatrix space = bounding ? SvgMatrix{box->width, 0, 0, box->height, box->x, box->y} : SvgMatrix{};
    out.transform = g.gradientTransform ? space * *g.gradientTransform : space;
    return SvgPaint{.gradient = std::move(out), .opacity = opacity};
  }

  SvgPath clipPathOf(const SvgNode &clip) const {
    SvgPath out;
    for (const auto &child : clip.children) {
      collectClip(child, clip.element.matrix.value_or(SvgMatrix{}), out);
    }
    return out;
  }

  void collectClip(const SvgNode &node, const SvgMatrix &outer, SvgPath &out) const {
    if (node.element.hidden) {
      return;
    }
    SvgMatrix m = node.element.matrix ? outer * *node.element.matrix : outer;
    if (auto p = shape(node.element)) {
      out.append(*p, m);
      return;
    }
    if (node.element.kind == SvgKind::Use) {
      if (const auto *target = named(node.element.href); target != nullptr && target != &node) {
        double x = length(node.element, "x", Axis::X), y = length(node.element, "y", Axis::Y);
        collectClip(*target, m * SvgMatrix::translate(x, y), out);
      }
      return;
    }
    for (const auto &child : node.children) {
      collectClip(child, m, out);
    }
  }

  void drawNode(const SvgNode &node, const Style &parent) {
    const auto &e = node.element;
    if (e.hidden) {
      return;
    }
    switch (e.kind) {
      case SvgKind::Svg:
      case SvgKind::Defs:
      case SvgKind::LinearGradient:
      case SvgKind::RadialGradient:
      case SvgKind::ClipPath:
      case SvgKind::Mask:
      case SvgKind::Symbol:
        return;
      default:
        break;
    }
    if (active_.contains(&node)) {
      return;
    }
    Style style = merge(parent, e);
    const SvgNode *clip = e.clipPath.empty() ? nullptr : named(e.clipPath, {SvgKind::ClipPath});
    const SvgNode *mask = e.mask.empty() ? nullptr : named(e.mask, {SvgKind::Mask});
    bool saved = e.matrix.has_value() || clip != nullptr;
    if (saved) {
      canvas_.save();
      if (e.matrix) {
        canvas_.concat(*e.matrix);
      }
      if (clip != nullptr) {
        canvas_.clip(clipPathOf(*clip), e.clipRule == 0);
      }
    }
    bool layer = e.opacity < 1;
    if (layer) {
      canvas_.beginLayer(std::max(0.0, e.opacity));
    }
    if (mask != nullptr) {
      beginMask(*mask, bounds(node));
    }
    active_.insert(&node);
    drawContent(node, style);
    active_.erase(&node);
    if (mask != nullptr) {
      canvas_.endMasked();
    }
    if (layer) {
      canvas_.endLayer();
    }
    if (saved) {
      canvas_.restore();
    }
  }

  void beginMask(const SvgNode &mask, const std::optional<SvgRect> &box) {
    const auto &m = mask.element;
    canvas_.beginMask(m.maskType == 1);
    bool bounding = m.units == 0;
    SvgRect b = box.value_or(SvgRect{});
    auto at = [&](const char *name, Axis axis, double fraction) {
      auto found = m.lengths.find(name);
      SvgLength l = found != m.lengths.end() && found->second.set ? found->second
                                                                  : SvgLength{.value = fraction * 100, .unit = SvgLength::Unit::Percent, .set = true};
      if (bounding) {
        double f = l.unit == SvgLength::Unit::Percent ? l.value / 100 : l.value;
        return f * (axis == Axis::X ? b.width : b.height);
      }
      return resolve(l, axis);
    };
    double x = at("x", Axis::X, -0.1) + (bounding ? b.x : 0);
    double y = at("y", Axis::Y, -0.1) + (bounding ? b.y : 0);
    canvas_.clip(rectPath(x, y, at("width", Axis::X, 1.2), at("height", Axis::Y, 1.2)), false);
    bool content = m.contentUnits == 0 && box;
    if (content) {
      canvas_.save();
      canvas_.concat(SvgMatrix{b.width, 0, 0, b.height, b.x, b.y});
    }
    Style style = merge(Style{}, m);
    for (const auto &child : mask.children) {
      drawNode(child, style);
    }
    if (content) {
      canvas_.restore();
    }
    canvas_.endMask();
  }

  void drawContent(const SvgNode &node, const Style &style) {
    const auto &e = node.element;
    if (auto p = shape(e)) {
      if (p->empty()) {
        return;
      }
      auto box = p->bounds();
      if (e.kind != SvgKind::Line) {
        if (auto fill = paint(style.fill, style.fillOpacity, style, box)) {
          canvas_.fill(*p, style.fillRule == 0, *fill);
        }
      }
      double width = resolve(style.strokeWidth, Axis::Other);
      if (width > 0) {
        if (auto stroke = paint(style.stroke, style.strokeOpacity, style, box)) {
          canvas_.stroke(*p, strokeOf(style, width), *stroke);
        }
      }
      return;
    }
    switch (e.kind) {
      case SvgKind::Group:
        for (const auto &child : node.children) {
          drawNode(child, style);
        }
        break;
      case SvgKind::Use:
        drawUse(e, style);
        break;
      case SvgKind::Image: {
        double w = length(e, "width", Axis::X), h = length(e, "height", Axis::Y);
        if (!e.uri.empty() && w > 0 && h > 0) {
          canvas_.image(e.uri, {length(e, "x", Axis::X), length(e, "y", Axis::Y), w, h}, e.align, e.meetOrSlice, 1);
        }
        break;
      }
      case SvgKind::Text:
      case SvgKind::TSpan: {
        double x = 0, y = 0;
        drawText(node, style, x, y);
        break;
      }
      default:
        break;
    }
  }

  SvgStroke strokeOf(const Style &style, double width) const {
    SvgStroke s{
        .width = width,
        .cap = style.strokeLinecap,
        .join = style.strokeLinejoin,
        .miterLimit = style.strokeMiterlimit,
        .dashOffset = style.strokeDashoffset};
    double total = 0;
    bool negative = false;
    for (const auto &d : style.strokeDasharray) {
      double v = resolve(d, Axis::Other);
      negative = negative || v < 0;
      total += v;
      s.dashes.push_back(v);
    }
    if (negative || total <= 0) {
      s.dashes.clear();
    } else if (s.dashes.size() % 2 == 1) {
      // An odd list repeats to make an even one, as SVG says.
      auto copy = s.dashes;
      s.dashes.insert(s.dashes.end(), copy.begin(), copy.end());
    }
    return s;
  }

  void drawUse(const SvgElement &use, const Style &style) {
    const SvgNode *target = named(use.href);
    if (target == nullptr || active_.contains(target)) {
      return;
    }
    double x = length(use, "x", Axis::X), y = length(use, "y", Axis::Y);
    bool moved = x != 0 || y != 0;
    if (moved) {
      canvas_.save();
      canvas_.concat(SvgMatrix::translate(x, y));
    }
    if (target->element.kind == SvgKind::Symbol) {
      const auto &symbol = target->element;
      Style inner = merge(style, symbol);
      bool fitted = symbol.vbWidth > 0 && symbol.vbHeight > 0;
      if (fitted) {
        double w = has(use, "width") ? length(use, "width", Axis::X) : vw_;
        double h = has(use, "height") ? length(use, "height", Axis::Y) : vh_;
        auto m = svgViewBoxTransform({symbol.minX, symbol.minY, symbol.vbWidth, symbol.vbHeight}, symbol.align, symbol.meetOrSlice, w, h);
        canvas_.save();
        canvas_.concat(m);
      }
      active_.insert(target);
      for (const auto &child : target->children) {
        drawNode(child, inner);
      }
      active_.erase(target);
      if (fitted) {
        canvas_.restore();
      }
    } else {
      drawNode(*target, style);
    }
    if (moved) {
      canvas_.restore();
    }
  }

  // A text or a span: its own position, if it sets one, then its characters, then its spans, each
  // starting where the last one ended.
  void drawText(const SvgNode &node, const Style &style, double &x, double &y) {
    const auto &e = node.element;
    if (!e.xs.empty()) {
      x = resolve(e.xs[0], Axis::X, style.fontSize);
    }
    if (!e.ys.empty()) {
      y = resolve(e.ys[0], Axis::Y, style.fontSize);
    }
    if (!e.dxs.empty()) {
      x += resolve(e.dxs[0], Axis::X, style.fontSize);
    }
    if (!e.dys.empty()) {
      y += resolve(e.dys[0], Axis::Y, style.fontSize);
    }
    if (!e.content.empty()) {
      auto fill = paint(style.fill, style.fillOpacity, style, std::nullopt);
      x += canvas_.text(e.content, x, y, style.fontSize, style.fontFamily, style.fontWeight, fill ? &*fill : nullptr);
    }
    for (const auto &child : node.children) {
      if (child.element.hidden || (child.element.kind != SvgKind::TSpan && child.element.kind != SvgKind::Text)) {
        continue;
      }
      Style inner = merge(style, child.element);
      drawText(child, inner, x, y);
    }
  }

  const SvgDocument &document_;
  double width_, height_;
  double vw_{0}, vh_{0};
  SvgCanvas &canvas_;
  std::unordered_map<std::string, const SvgNode *> names_;
  // What is being drawn, so a `use` of it, or of what holds it, draws nothing.
  std::unordered_set<const SvgNode *> active_;
};

} // namespace

void drawSvg(const SvgDocument &document, double width, double height, SvgCanvas &canvas) {
  Renderer(document, width, height, canvas).draw();
}

// --- the svgs mounted ----------------------------------------------------------------------------

SvgDrawings::SvgDrawings(Reader reader) : reader_(std::move(reader)) {}

std::optional<SvgElement> SvgDrawings::element(const ViewTree &tree, Tag tag) const {
  const auto *found = tree.find(tag);
  if (found == nullptr || !found->view.props) {
    return std::nullopt;
  }
  if (reader_) {
    return reader_(*found->view.props);
  }
  const auto &glue = libraryGlue().svgElement;
  return glue ? glue(*found->view.props) : std::nullopt;
}

void SvgDrawings::changed(const ViewTree &tree, Tag tag) {
  for (Tag at = tag; at != -1;) {
    auto e = element(tree, at);
    if (!e) {
      return;
    }
    if (e->kind == SvgKind::Svg) {
      dirty_.insert(at);
      return;
    }
    const auto *found = tree.find(at);
    at = found == nullptr ? -1 : found->parent;
  }
}

void SvgDrawings::deleted(Tag tag) {
  dirty_.erase(tag);
  drawn_.erase(tag);
}

std::optional<SvgNode> SvgDrawings::node(const ViewTree &tree, Tag tag) const {
  auto e = element(tree, tag);
  if (!e) {
    return std::nullopt;
  }
  SvgNode out{.element = std::move(*e)};
  for (Tag child : tree.find(tag)->children) {
    if (auto c = node(tree, child); c && c->element.kind != SvgKind::Svg) {
      out.children.push_back(std::move(*c));
    }
  }
  return out;
}

std::vector<SvgDrawings::Drawing> SvgDrawings::settle(const ViewTree &tree) {
  std::vector<Tag> dirty(dirty_.begin(), dirty_.end());
  dirty_.clear();
  std::sort(dirty.begin(), dirty.end());
  std::vector<Drawing> out;
  for (Tag tag : dirty) {
    auto root = node(tree, tag);
    if (!root || root->element.kind != SvgKind::Svg) {
      continue;
    }
    auto document = std::make_shared<const SvgDocument>(SvgDocument{.root = std::move(*root)});
    auto known = drawn_.find(tag);
    if (known != drawn_.end() && *known->second == *document) {
      continue;
    }
    drawn_[tag] = document;
    out.push_back({.svg = tag, .document = std::move(document)});
  }
  return out;
}

} // namespace ngn
