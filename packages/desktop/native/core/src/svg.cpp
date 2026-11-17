#include "ngn/svg.h"

#include "ngn/library-glue.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

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
  auto add = [&](double x, double y) {
    if (!any) {
      minX = maxX = x;
      minY = maxY = y;
      any = true;
    }
    minX = std::min(minX, x);
    maxX = std::max(maxX, x);
    minY = std::min(minY, y);
    maxY = std::max(maxY, y);
  };
  // A cubic's extremes along one axis inside the curve, where its derivative is zero: the control
  // points themselves are off the curve and outside the bounds.
  auto extremes = [](double p0, double p1, double p2, double p3) {
    std::vector<double> ts;
    double a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    auto inside = [&](double t) {
      if (t > 0 && t < 1) {
        ts.push_back(t);
      }
    };
    if (std::fabs(a) < 1e-12) {
      if (std::fabs(b) > 1e-12) {
        inside(-c / b);
      }
    } else if (double d = b * b - 4 * a * c; d >= 0) {
      inside((-b + std::sqrt(d)) / (2 * a));
      inside((-b - std::sqrt(d)) / (2 * a));
    }
    return ts;
  };
  auto at = [](double t, double p0, double p1, double p2, double p3) {
    double u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  double x = 0, y = 0, startX = 0, startY = 0;
  for (const auto &s : segments) {
    const auto &p = s.points;
    switch (s.op) {
      case Op::Move:
        startX = x = p[0];
        startY = y = p[1];
        add(x, y);
        break;
      case Op::Line:
        x = p[0];
        y = p[1];
        add(x, y);
        break;
      case Op::Cubic:
        for (double t : extremes(x, p[0], p[2], p[4])) {
          add(at(t, x, p[0], p[2], p[4]), at(t, y, p[1], p[3], p[5]));
        }
        for (double t : extremes(y, p[1], p[3], p[5])) {
          add(at(t, x, p[0], p[2], p[4]), at(t, y, p[1], p[3], p[5]));
        }
        x = p[4];
        y = p[5];
        add(x, y);
        break;
      case Op::Close:
        x = startX;
        y = startY;
        break;
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
      // Z takes no numbers, so a number after it is an error that ends the path.
      command.reset();
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

// A path as lines, for text set along it, measured from its start.
struct TextTrack {
  struct Line {
    double x0, y0, x1, y1, length;
  };
  std::vector<Line> lines;
  double length{0};

  // The point `distance` along the track and its direction there in radians, the next line's at a
  // corner; nothing off the track, whose very end is off it, as Chrome places glyphs.
  std::optional<std::array<double, 3>> at(double distance) const {
    if (distance < 0) {
      return std::nullopt;
    }
    double from = 0;
    for (const auto &l : lines) {
      if (distance < from + l.length) {
        double t = (distance - from) / l.length;
        return std::array<double, 3>{l.x0 + (l.x1 - l.x0) * t, l.y0 + (l.y1 - l.y0) * t, std::atan2(l.y1 - l.y0, l.x1 - l.x0)};
      }
      from += l.length;
    }
    return std::nullopt;
  }
};

// `path` as lines, each curve as 128, in order or reversed. A move between subpaths adds no length.
TextTrack textTrack(const SvgPath &path, bool reversed) {
  TextTrack track;
  double x = 0, y = 0, startX = 0, startY = 0;
  auto line = [&](double toX, double toY) {
    track.lines.push_back({x, y, toX, toY, std::hypot(toX - x, toY - y)});
    x = toX;
    y = toY;
  };
  for (const auto &s : path.segments) {
    const double *p = s.points;
    switch (s.op) {
      case SvgPath::Op::Move:
        x = startX = p[0];
        y = startY = p[1];
        break;
      case SvgPath::Op::Line:
        line(p[0], p[1]);
        break;
      case SvgPath::Op::Cubic: {
        double x0 = x, y0 = y;
        constexpr int steps = 128;
        for (int i = 1; i <= steps; ++i) {
          double t = static_cast<double>(i) / steps, u = 1 - t;
          double a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
          line(a * x0 + b * p[0] + c * p[2] + d * p[4], a * y0 + b * p[1] + c * p[3] + d * p[5]);
        }
        break;
      }
      case SvgPath::Op::Close:
        line(startX, startY);
        break;
    }
  }
  if (reversed) {
    std::reverse(track.lines.begin(), track.lines.end());
    for (auto &l : track.lines) {
      std::swap(l.x0, l.x1);
      std::swap(l.y0, l.y1);
    }
  }
  for (const auto &l : track.lines) {
    track.length += l.length;
  }
  return track;
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
  std::string textAnchor{"start"};
  // The attributes set somewhere above or on the element, which its children inherit.
  std::unordered_set<std::string> list;
};

class Renderer {
 public:
  Renderer(const SvgDocument &document, double width, double height, SvgCanvas &canvas)
      : document_(document), width_(width), height_(height), canvas_(&canvas) {
    index(document.root);
  }

  void draw() {
    const auto &root = document_.root.element;
    double vw = root.bbWidth.set ? resolveIn(root.bbWidth, width_) : width_;
    double vh = root.bbHeight.set ? resolveIn(root.bbHeight, height_) : height_;
    canvas_->save();
    if (root.vbWidth > 0 && root.vbHeight > 0) {
      auto m = svgViewBoxTransform({root.minX, root.minY, root.vbWidth, root.vbHeight}, root.align, root.meetOrSlice, vw, vh);
      if (!isIdentity(m)) {
        canvas_->concat(m);
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
    canvas_->restore();
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
    s.textAnchor = e.textAnchor.empty() ? parent.textAnchor : e.textAnchor;
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
    std::unordered_set<const SvgNode *> within;
    for (const auto &child : clip.children) {
      collectClip(child, clip.element.matrix.value_or(SvgMatrix{}), out, within);
    }
    return out;
  }

  // `within` holds the uses being expanded, so a use that leads back to itself, directly or
  // through others, is an invalid reference that adds nothing, as SVG has it.
  void collectClip(const SvgNode &node, const SvgMatrix &outer, SvgPath &out, std::unordered_set<const SvgNode *> &within) const {
    if (node.element.hidden) {
      return;
    }
    SvgMatrix m = node.element.matrix ? outer * *node.element.matrix : outer;
    if (auto p = shape(node.element)) {
      out.append(*p, m);
      return;
    }
    if (node.element.kind == SvgKind::Use) {
      if (const auto *target = named(node.element.href); target != nullptr && within.insert(&node).second) {
        double x = length(node.element, "x", Axis::X), y = length(node.element, "y", Axis::Y);
        collectClip(*target, m * SvgMatrix::translate(x, y), out, within);
        within.erase(&node);
      }
      return;
    }
    for (const auto &child : node.children) {
      collectClip(child, m, out, within);
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
      case SvgKind::Marker:
      case SvgKind::Pattern:
      case SvgKind::Filter:
      case SvgKind::FeGaussianBlur:
      case SvgKind::FeOffset:
      case SvgKind::FeColorMatrix:
      case SvgKind::FeFlood:
      case SvgKind::FeComposite:
      case SvgKind::FeMerge:
        return;
      default:
        break;
    }
    if (active_.contains(&node)) {
      return;
    }
    // A filter that is found but cannot run (no steps, or an empty box for its units) leaves the
    // element undrawn, as SVG says; one that is not found is ignored.
    std::optional<SvgFilter> filter;
    if (const SvgNode *f = e.filter.empty() ? nullptr : named(e.filter, {SvgKind::Filter})) {
      filter = filterOf(*f, bounds(node));
      if (!filter) {
        return;
      }
    }
    Style style = merge(parent, e);
    const SvgNode *clip = e.clipPath.empty() ? nullptr : named(e.clipPath, {SvgKind::ClipPath});
    const SvgNode *mask = e.mask.empty() ? nullptr : named(e.mask, {SvgKind::Mask});
    bool saved = e.matrix.has_value() || clip != nullptr;
    if (saved) {
      canvas_->save();
      if (e.matrix) {
        canvas_->concat(*e.matrix);
      }
      if (clip != nullptr) {
        canvas_->clip(clipPathOf(*clip), e.clipRule == 0);
      }
    }
    bool layer = e.opacity < 1;
    if (layer) {
      canvas_->beginLayer(std::max(0.0, e.opacity));
    }
    // Active before its mask is drawn: a mask that holds the node, or one masked by that mask
    // again, is a circular reference that draws it no further.
    active_.insert(&node);
    if (mask != nullptr) {
      beginMask(*mask, bounds(node));
    }
    if (filter) {
      canvas_->beginFilter(*filter);
    }
    drawContent(node, style);
    active_.erase(&node);
    if (filter) {
      canvas_->endFilter();
    }
    if (mask != nullptr) {
      canvas_->endMasked();
    }
    if (layer) {
      canvas_->endLayer();
    }
    if (saved) {
      canvas_->restore();
    }
  }

  void beginMask(const SvgNode &mask, const std::optional<SvgRect> &box) {
    const auto &m = mask.element;
    canvas_->beginMask(m.maskType == 1);
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
    canvas_->clip(rectPath(x, y, at("width", Axis::X, 1.2), at("height", Axis::Y, 1.2)), false);
    bool content = m.contentUnits == 0 && box;
    if (content) {
      canvas_->save();
      canvas_->concat(SvgMatrix{b.width, 0, 0, b.height, b.x, b.y});
    }
    Style style = merge(Style{}, m);
    for (const auto &child : mask.children) {
      drawNode(child, style);
    }
    if (content) {
      canvas_->restore();
    }
    canvas_->endMask();
  }

  void drawContent(const SvgNode &node, const Style &style) {
    const auto &e = node.element;
    if (auto p = shape(e)) {
      if (p->empty()) {
        return;
      }
      auto box = p->bounds();
      if (e.kind != SvgKind::Line) {
        if (const SvgNode *pattern = patternOf(style.fill)) {
          canvas_->save();
          canvas_->clip(*p, style.fillRule == 0);
          drawPattern(*pattern, style.fillOpacity, box);
          canvas_->restore();
        } else if (auto fill = paint(style.fill, style.fillOpacity, style, box)) {
          canvas_->fill(*p, style.fillRule == 0, *fill);
        }
      }
      double width = resolve(style.strokeWidth, Axis::Other);
      if (width > 0) {
        if (const SvgNode *pattern = patternOf(style.stroke)) {
          canvas_->save();
          canvas_->clipToStroke(*p, strokeOf(style, width));
          drawPattern(*pattern, style.strokeOpacity, box);
          canvas_->restore();
        } else if (auto stroke = paint(style.stroke, style.strokeOpacity, style, box)) {
          canvas_->stroke(*p, strokeOf(style, width), *stroke);
        }
      }
      if ((e.kind == SvgKind::Path || e.kind == SvgKind::Line) &&
          !(e.markerStart.empty() && e.markerMid.empty() && e.markerEnd.empty())) {
        drawMarkers(e, *p, width);
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
          canvas_->image(e.uri, {length(e, "x", Axis::X), length(e, "y", Axis::Y), w, h}, e.align, e.meetOrSlice, 1);
        }
        break;
      }
      case SvgKind::Text:
      case SvgKind::TSpan:
        drawText(node, style);
        break;
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

  const SvgNode *patternOf(const SvgBrush &brush) const {
    return brush.type == SvgBrush::Type::Ref ? named(brush.ref, {SvgKind::Pattern}) : nullptr;
  }

  // A length of a pattern's, a filter's or a step's: a fraction of `box` (added to its origin for
  // a position) in objectBoundingBox units, a user length otherwise; `fallback` when unset.
  double unitLength(const SvgElement &e, const char *name, Axis axis, bool bounding, const SvgRect &box, double fallback) const {
    auto found = e.lengths.find(name);
    if (found == e.lengths.end() || !found->second.set) {
      return fallback;
    }
    if (!bounding) {
      return resolve(found->second, axis);
    }
    const auto &l = found->second;
    double fraction = l.unit == SvgLength::Unit::Percent ? l.value / 100 : l.value;
    return fraction * (axis == Axis::X ? box.width : box.height);
  }

  // Fills the clip with a pattern's tile repeated, the tile drawn on the canvas the canvas gives.
  void drawPattern(const SvgNode &pattern, double opacity, const std::optional<SvgRect> &box) {
    const auto &p = pattern.element;
    bool bounding = p.units == 0;
    if (active_.contains(&pattern) || (bounding && (!box || box->width <= 0 || box->height <= 0))) {
      return;
    }
    SvgRect b = box.value_or(SvgRect{});
    SvgPatternTile tile{
        .tile =
            {unitLength(p, "x", Axis::X, bounding, b, 0) + (bounding ? b.x : 0),
             unitLength(p, "y", Axis::Y, bounding, b, 0) + (bounding ? b.y : 0),
             unitLength(p, "width", Axis::X, bounding, b, 0),
             unitLength(p, "height", Axis::Y, bounding, b, 0)},
        .transform = p.gradientTransform.value_or(SvgMatrix{}),
    };
    if (tile.tile.width <= 0 || tile.tile.height <= 0) {
      return;
    }
    // Content in the tile's own space: through the viewBox if it has one, else in fractions of the
    // box for objectBoundingBox content units.
    std::optional<SvgMatrix> content;
    if (p.vbWidth > 0 && p.vbHeight > 0) {
      content = svgViewBoxTransform({p.minX, p.minY, p.vbWidth, p.vbHeight}, p.align, p.meetOrSlice, tile.tile.width, tile.tile.height);
    } else if (p.contentUnits == 0 && box) {
      content = SvgMatrix{b.width, 0, 0, b.height, 0, 0};
    }
    Style style = merge(Style{}, p);
    SvgCanvas *outer = canvas_;
    active_.insert(&pattern);
    outer->pattern(tile, opacity, [&](SvgCanvas &tileCanvas) {
      canvas_ = &tileCanvas;
      if (content) {
        canvas_->save();
        canvas_->concat(*content);
      }
      for (const auto &child : pattern.children) {
        drawNode(child, style);
      }
      if (content) {
        canvas_->restore();
      }
      canvas_ = outer;
    });
    active_.erase(&pattern);
  }

  void drawMarkers(const SvgElement &e, const SvgPath &path, double strokeWidth) {
    auto vertices = svgMarkerVertices(path);
    auto draw = [&](const std::string &name, const SvgMarkerVertex &v) {
      const SvgNode *marker = name.empty() ? nullptr : named(name, {SvgKind::Marker});
      if (marker != nullptr && !active_.contains(marker)) {
        drawMarker(*marker, v, strokeWidth);
      }
    };
    for (const auto &v : vertices) {
      switch (v.place) {
        case SvgMarkerVertex::Place::Start:
          draw(e.markerStart, v);
          if (vertices.size() == 1) {
            draw(e.markerEnd, v);
          }
          break;
        case SvgMarkerVertex::Place::Mid:
          draw(e.markerMid, v);
          break;
        case SvgMarkerVertex::Place::End:
          draw(e.markerEnd, v);
          break;
      }
    }
  }

  void drawMarker(const SvgNode &marker, const SvgMarkerVertex &v, double strokeWidth) {
    const auto &m = marker.element;
    double mw = length(m, "markerWidth", Axis::X, 3), mh = length(m, "markerHeight", Axis::Y, 3);
    if (mw <= 0 || mh <= 0) {
      return;
    }
    double angle = 0;
    if (m.orient == "auto") {
      angle = v.angle;
    } else if (m.orient == "auto-start-reverse") {
      angle = v.place == SvgMarkerVertex::Place::Start ? v.angle + 180 : v.angle;
    } else if (!m.orient.empty()) {
      angle = std::strtod(m.orient.c_str(), nullptr);
    }
    double scale = m.markerUnits == "userSpaceOnUse" ? 1 : strokeWidth;
    double radians = angle * M_PI / 180;
    double cos = std::cos(radians), sin = std::sin(radians);
    SvgMatrix place = SvgMatrix::translate(v.x, v.y) * SvgMatrix{cos, sin, -sin, cos, 0, 0} * SvgMatrix::scale(scale, scale);
    SvgMatrix fit = m.vbWidth > 0 && m.vbHeight > 0
                        ? svgViewBoxTransform({m.minX, m.minY, m.vbWidth, m.vbHeight}, m.align, m.meetOrSlice, mw, mh)
                        : SvgMatrix{};
    // The ref point, in the marker's content, sits on the vertex.
    auto [refX, refY] = fit.apply(length(m, "refX", Axis::X), length(m, "refY", Axis::Y));
    canvas_->save();
    canvas_->concat(place);
    if (refX != 0 || refY != 0) {
      canvas_->concat(SvgMatrix::translate(-refX, -refY));
    }
    // A marker's overflow is hidden: its content shows only in its box.
    canvas_->clip(rectPath(0, 0, mw, mh), false);
    if (!isIdentity(fit)) {
      canvas_->concat(fit);
    }
    Style style = merge(Style{}, m);
    active_.insert(&marker);
    for (const auto &child : marker.children) {
      drawNode(child, style);
    }
    active_.erase(&marker);
    canvas_->restore();
  }

  // A filter's steps for an element whose box is `box`, or nothing when it cannot run.
  std::optional<SvgFilter> filterOf(const SvgNode &filter, const std::optional<SvgRect> &box) const {
    const auto &f = filter.element;
    bool bounding = f.units == 0;
    bool primitiveBounding = f.contentUnits == 0;
    if ((bounding || primitiveBounding) && (!box || box->width <= 0 || box->height <= 0)) {
      return std::nullopt;
    }
    SvgRect b = box.value_or(SvgRect{});
    // The region SVG gives a filter that says nothing: a tenth over each side.
    auto regionLength = [&](const char *name, Axis axis, double fraction, bool position) {
      double fallback = bounding ? fraction * (axis == Axis::X ? b.width : b.height)
                                 : resolve({.value = fraction * 100, .unit = SvgLength::Unit::Percent, .set = true}, axis);
      return unitLength(f, name, axis, bounding, b, fallback) + (bounding && position ? (axis == Axis::X ? b.x : b.y) : 0);
    };
    SvgFilter out{
        .region =
            {regionLength("x", Axis::X, -0.1, true),
             regionLength("y", Axis::Y, -0.1, true),
             regionLength("width", Axis::X, 1.2, false),
             regionLength("height", Axis::Y, 1.2, false)},
        .steps = {},
    };
    if (out.region.width <= 0 || out.region.height <= 0) {
      return std::nullopt;
    }
    std::string previous = "SourceGraphic";
    for (const auto &child : filter.children) {
      const auto &e = child.element;
      SvgFilterStep step;
      switch (e.kind) {
        case SvgKind::FeGaussianBlur:
          step.type = SvgFilterStep::Type::GaussianBlur;
          step.stdDeviationX = std::max(0.0, e.stdDeviationX) * (primitiveBounding ? b.width : 1);
          step.stdDeviationY = std::max(0.0, e.stdDeviationY) * (primitiveBounding ? b.height : 1);
          break;
        case SvgKind::FeOffset:
          step.type = SvgFilterStep::Type::Offset;
          step.dx = unitLength(e, "dx", Axis::X, primitiveBounding, b, 0);
          step.dy = unitLength(e, "dy", Axis::Y, primitiveBounding, b, 0);
          break;
        case SvgKind::FeColorMatrix:
          step.type = SvgFilterStep::Type::ColorMatrix;
          step.matrix = svgColorMatrix(e.op, e.values);
          break;
        case SvgKind::FeFlood: {
          step.type = SvgFilterStep::Type::Flood;
          step.argb = e.flood.type == SvgBrush::Type::Color ? e.flood.argb : 0;
          step.opacity = std::clamp(e.floodOpacity, 0.0, 1.0);
          break;
        }
        case SvgKind::FeComposite:
          step.type = SvgFilterStep::Type::Composite;
          step.op = e.op;
          step.k = e.k;
          break;
        case SvgKind::FeMerge:
          step.type = SvgFilterStep::Type::Merge;
          for (const auto &input : e.nodes) {
            step.inputs.push_back(input.empty() ? previous : input);
          }
          break;
        default:
          continue;
      }
      step.in1 = e.in1.empty() ? previous : e.in1;
      step.in2 = e.in2.empty() ? previous : e.in2;
      step.result = e.result.empty() ? "#" + std::to_string(out.steps.size()) : e.result;
      // A step's own x, y, width and height cut it within the region.
      auto sub = [&](const char *name, Axis axis, double fallback, bool position) {
        auto found = e.lengths.find(name);
        if (found == e.lengths.end() || !found->second.set) {
          return fallback;
        }
        return unitLength(e, name, axis, primitiveBounding, b, fallback) +
               (primitiveBounding && position ? (axis == Axis::X ? b.x : b.y) : 0);
      };
      step.subregion = {
          sub("x", Axis::X, out.region.x, true),
          sub("y", Axis::Y, out.region.y, true),
          sub("width", Axis::X, out.region.width, false),
          sub("height", Axis::Y, out.region.height, false)};
      previous = step.result;
      out.steps.push_back(std::move(step));
    }
    if (out.steps.empty()) {
      return std::nullopt;
    }
    return out;
  }

  void drawUse(const SvgElement &use, const Style &style) {
    const SvgNode *target = named(use.href);
    if (target == nullptr || active_.contains(target)) {
      return;
    }
    double x = length(use, "x", Axis::X), y = length(use, "y", Axis::Y);
    bool moved = x != 0 || y != 0;
    if (moved) {
      canvas_->save();
      canvas_->concat(SvgMatrix::translate(x, y));
    }
    if (target->element.kind == SvgKind::Symbol) {
      const auto &symbol = target->element;
      Style inner = merge(style, symbol);
      bool fitted = symbol.vbWidth > 0 && symbol.vbHeight > 0;
      if (fitted) {
        double w = has(use, "width") ? length(use, "width", Axis::X) : vw_;
        double h = has(use, "height") ? length(use, "height", Axis::Y) : vh_;
        auto m = svgViewBoxTransform({symbol.minX, symbol.minY, symbol.vbWidth, symbol.vbHeight}, symbol.align, symbol.meetOrSlice, w, h);
        canvas_->save();
        canvas_->concat(m);
      }
      active_.insert(target);
      for (const auto &child : target->children) {
        drawNode(child, inner);
      }
      active_.erase(target);
      if (fitted) {
        canvas_->restore();
      }
    } else {
      drawNode(*target, style);
    }
    if (moved) {
      canvas_->restore();
    }
  }

  // Text is laid out before it is drawn: runs of characters in chunks, as SVG has them, each chunk
  // set back by its anchor once its advance is known.
  struct TextRun {
    std::string text;
    double x{0}, y{0}, advance{0};
    double fontSize{12};
    std::string fontFamily, fontWeight;
    std::optional<SvgPaint> fill;
    // The opacity of the spans and textPath it is in, which draw through no drawNode of their own.
    double opacity{1};
  };
  struct TextChunk {
    std::string anchor;
    std::vector<TextRun> runs;
    // On a path: the path, and how far along it a run's x of 0 is; a run's y is then off the path.
    std::shared_ptr<const TextTrack> track;
    double startOffset{0};
  };
  struct TextLayout {
    std::vector<TextChunk> chunks;
    double x{0}, y{0};
    // The next characters start a chunk: an absolute position or a path came before them.
    bool chunkStarts{true};
    std::shared_ptr<const TextTrack> track;
    double startOffset{0};
    double opacity{1};
  };

  static double anchorShift(const TextChunk &chunk) {
    double advance = chunk.runs.back().x + chunk.runs.back().advance - chunk.runs.front().x;
    return chunk.anchor == "middle" ? -advance / 2 : chunk.anchor == "end" ? -advance : 0;
  }

  void drawText(const SvgNode &node, const Style &style) {
    TextLayout layout;
    layoutText(node, style, layout);
    for (const auto &chunk : layout.chunks) {
      drawChunk(chunk);
    }
  }

  void layoutChildren(const SvgNode &node, const Style &style, TextLayout &out) {
    for (const auto &child : node.children) {
      auto kind = child.element.kind;
      if (!child.element.hidden && (kind == SvgKind::TSpan || kind == SvgKind::Text || kind == SvgKind::TextPath)) {
        double opacity = out.opacity;
        out.opacity *= std::clamp(child.element.opacity, 0.0, 1.0);
        layoutText(child, merge(style, child.element), out);
        out.opacity = opacity;
      }
    }
  }

  // A text or a span: its own position, if it sets one, then its characters, then what it holds,
  // each starting where the last ended. An x or a y starts a chunk. On a path, as Chrome sets it,
  // x and dx are along the path from startOffset, dy is off it, and y places nothing.
  void layoutText(const SvgNode &node, const Style &style, TextLayout &out) {
    const auto &e = node.element;
    if (e.kind == SvgKind::TextPath) {
      layoutTextPath(node, style, out);
      return;
    }
    if (!e.xs.empty()) {
      out.x = resolve(e.xs[0], Axis::X, style.fontSize);
      out.chunkStarts = true;
    }
    if (!out.track && !e.ys.empty()) {
      out.y = resolve(e.ys[0], Axis::Y, style.fontSize);
      out.chunkStarts = true;
    }
    if (!e.dxs.empty()) {
      out.x += resolve(e.dxs[0], Axis::X, style.fontSize);
    }
    if (!e.dys.empty()) {
      out.y += resolve(e.dys[0], Axis::Y, style.fontSize);
    }
    if (!e.content.empty()) {
      if (out.chunkStarts) {
        out.chunks.push_back({.anchor = style.textAnchor, .track = out.track, .startOffset = out.startOffset});
        out.chunkStarts = false;
      }
      double advance = canvas_->measureText(e.content, style.fontSize, style.fontFamily, style.fontWeight);
      out.chunks.back().runs.push_back(
          {.text = e.content,
           .x = out.x,
           .y = out.y,
           .advance = advance,
           .fontSize = style.fontSize,
           .fontFamily = style.fontFamily,
           .fontWeight = style.fontWeight,
           .fill = paint(style.fill, style.fillOpacity, style, std::nullopt),
           .opacity = out.opacity});
      out.x += advance;
    }
    layoutChildren(node, style, out);
  }

  // A textPath: what it holds along the shape it names, from startOffset, as a chunk of its own;
  // what follows carries on from the path's end, as Chrome places it. One that names no shape, or
  // is on a path already, draws nothing.
  void layoutTextPath(const SvgNode &node, const Style &style, TextLayout &out) {
    const auto &e = node.element;
    const SvgNode *target = out.track ? nullptr : named(e.href);
    auto shapePath = target ? shape(target->element) : std::nullopt;
    if (!shapePath) {
      return;
    }
    SvgPath path;
    path.append(*shapePath, target->element.matrix.value_or(SvgMatrix{}));
    auto track = std::make_shared<const TextTrack>(textTrack(path, e.side == "right"));
    if (track->length <= 0) {
      return;
    }
    auto offset = e.lengths.find("startOffset");
    out.track = track;
    out.startOffset = offset == e.lengths.end() ? 0 : resolveIn(offset->second, track->length, style.fontSize);
    out.x = out.y = 0;
    out.chunkStarts = true;
    layoutChildren(node, style, out);
    out.track.reset();
    out.x = track->lines.back().x1;
    out.y = track->lines.back().y1;
    out.chunkStarts = true;
  }

  void drawChunk(const TextChunk &chunk) {
    double shift = anchorShift(chunk);
    for (const auto &run : chunk.runs) {
      if (!run.fill || run.opacity <= 0) {
        continue;
      }
      bool layer = run.opacity < 1;
      if (layer) {
        canvas_->beginLayer(run.opacity);
      }
      drawRun(chunk, run, shift);
      if (layer) {
        canvas_->endLayer();
      }
    }
  }

  void drawRun(const TextChunk &chunk, const TextRun &run, double shift) {
    if (!chunk.track) {
      canvas_->text(run.text, run.x + shift, run.y, run.fontSize, run.fontFamily, run.fontWeight, *run.fill);
      return;
    }
    // Each glyph at the point its middle reaches along the path, turned with the path there, from
    // where the shaped run has it, so a kerned pair keeps its kerning.
    for (const auto &glyph : canvas_->glyphClusters(run.text, run.fontSize, run.fontFamily, run.fontWeight)) {
      auto at = chunk.track->at(chunk.startOffset + shift + run.x + glyph.x + glyph.advance / 2);
      if (!at) {
        continue;
      }
      double cos = std::cos((*at)[2]), sin = std::sin((*at)[2]);
      canvas_->save();
      canvas_->concat({cos, sin, -sin, cos, (*at)[0], (*at)[1]});
      canvas_->text(glyph.text, -glyph.advance / 2, run.y, run.fontSize, run.fontFamily, run.fontWeight, *run.fill);
      canvas_->restore();
    }
  }

  const SvgDocument &document_;
  double width_, height_;
  double vw_{0}, vh_{0};
  // The canvas drawn on: the svg's own, or a pattern's tile's while one is drawn.
  SvgCanvas *canvas_;
  std::unordered_map<std::string, const SvgNode *> names_;
  // What is being drawn, so a `use` of it, or of what holds it, draws nothing.
  std::unordered_set<const SvgNode *> active_;
};

} // namespace

std::vector<SvgMarkerVertex> svgMarkerVertices(const SvgPath &path) {
  // Directions in degrees, NaN where a vertex has none that way.
  struct Vertex {
    double x, y;
    double in{NAN}, out{NAN};
  };
  auto direction = [](double x0, double y0, double x1, double y1) { return std::atan2(y1 - y0, x1 - x0) * 180 / M_PI; };
  std::vector<Vertex> vertices;
  size_t subpath = 0;
  double cx = 0, cy = 0;
  for (const auto &s : path.segments) {
    const double *p = s.points;
    switch (s.op) {
      case SvgPath::Op::Move:
        vertices.push_back({p[0], p[1]});
        subpath = vertices.size() - 1;
        cx = p[0];
        cy = p[1];
        break;
      case SvgPath::Op::Line: {
        if (vertices.empty()) {
          vertices.push_back({cx, cy});
        }
        double d = direction(cx, cy, p[0], p[1]);
        if (std::isnan(vertices.back().out)) {
          vertices.back().out = d;
        }
        vertices.push_back({p[0], p[1], d});
        cx = p[0];
        cy = p[1];
        break;
      }
      case SvgPath::Op::Cubic: {
        if (vertices.empty()) {
          vertices.push_back({cx, cy});
        }
        // Leaving towards the first control point that is not on the start, arriving from the last
        // that is not on the end.
        double out = p[0] != cx || p[1] != cy   ? direction(cx, cy, p[0], p[1])
                     : p[2] != cx || p[3] != cy ? direction(cx, cy, p[2], p[3])
                                                : direction(cx, cy, p[4], p[5]);
        double in = p[2] != p[4] || p[3] != p[5]   ? direction(p[2], p[3], p[4], p[5])
                    : p[0] != p[4] || p[1] != p[5] ? direction(p[0], p[1], p[4], p[5])
                                                   : direction(cx, cy, p[4], p[5]);
        if (std::isnan(vertices.back().out)) {
          vertices.back().out = out;
        }
        vertices.push_back({p[4], p[5], in});
        cx = p[4];
        cy = p[5];
        break;
      }
      case SvgPath::Op::Close: {
        if (vertices.empty()) {
          break;
        }
        const Vertex start = vertices[subpath];
        double d = direction(cx, cy, start.x, start.y);
        if (std::isnan(vertices.back().out)) {
          vertices.back().out = d;
        }
        // A closed subpath's ends both bisect the closing line and its first segment.
        vertices.push_back({start.x, start.y, d, start.out});
        vertices[subpath].in = d;
        cx = start.x;
        cy = start.y;
        break;
      }
    }
  }
  std::vector<SvgMarkerVertex> out;
  for (size_t i = 0; i < vertices.size(); ++i) {
    const auto &v = vertices[i];
    double angle = 0;
    if (!std::isnan(v.in) && !std::isnan(v.out)) {
      double a = v.in * M_PI / 180, b = v.out * M_PI / 180;
      angle = std::atan2(std::sin(a) + std::sin(b), std::cos(a) + std::cos(b)) * 180 / M_PI;
    } else if (!std::isnan(v.out)) {
      angle = v.out;
    } else if (!std::isnan(v.in)) {
      angle = v.in;
    }
    auto place = i == 0                   ? SvgMarkerVertex::Place::Start
                 : i + 1 == vertices.size() ? SvgMarkerVertex::Place::End
                                            : SvgMarkerVertex::Place::Mid;
    out.push_back({.place = place, .x = v.x, .y = v.y, .angle = angle});
  }
  return out;
}

std::array<double, 20> svgColorMatrix(int type, const std::vector<double> &values) {
  std::array<double, 20> m{1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0};
  switch (type) {
    case 0:
      if (values.size() == 20) {
        std::copy(values.begin(), values.end(), m.begin());
      }
      break;
    case 1: {
      double s = values.empty() ? 1 : values[0];
      m = {0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
           0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
           0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
           0, 0, 0, 1, 0};
      break;
    }
    case 2: {
      double a = (values.empty() ? 0 : values[0]) * M_PI / 180;
      double c = std::cos(a), s = std::sin(a);
      m = {0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
           0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0,
           0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
           0, 0, 0, 1, 0};
      break;
    }
    case 3:
      m = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154, 0.0721, 0, 0};
      break;
    default:
      break;
  }
  return m;
}

namespace {

// A filter's working image: premultiplied RGBA in 0 to 1.
struct FloatImage {
  int width{0}, height{0};
  std::vector<float> rgba;
  float *at(int x, int y) { return &rgba[static_cast<size_t>((y * width + x) * 4)]; }
  const float *at(int x, int y) const { return &rgba[static_cast<size_t>((y * width + x) * 4)]; }
};

FloatImage blank(int width, int height) {
  return {.width = width, .height = height, .rgba = std::vector<float>(static_cast<size_t>(width * height * 4), 0.0f)};
}

struct PixelBox {
  int x0, y0, x1, y1;
};

// The pixels a user-space rectangle covers: the bounds of its corners through `m`.
PixelBox pixelBox(const SvgRect &r, const SvgMatrix &m, int width, int height) {
  double xs[4], ys[4];
  std::tie(xs[0], ys[0]) = m.apply(r.x, r.y);
  std::tie(xs[1], ys[1]) = m.apply(r.x + r.width, r.y);
  std::tie(xs[2], ys[2]) = m.apply(r.x, r.y + r.height);
  std::tie(xs[3], ys[3]) = m.apply(r.x + r.width, r.y + r.height);
  auto [minX, maxX] = std::minmax({xs[0], xs[1], xs[2], xs[3]});
  auto [minY, maxY] = std::minmax({ys[0], ys[1], ys[2], ys[3]});
  auto clampTo = [](double v, int limit) { return static_cast<int>(std::clamp(v, 0.0, static_cast<double>(limit))); };
  return {clampTo(std::floor(minX + 1e-6), width), clampTo(std::floor(minY + 1e-6), height), clampTo(std::ceil(maxX - 1e-6), width),
          clampTo(std::ceil(maxY - 1e-6), height)};
}

void cut(FloatImage &image, const PixelBox &box) {
  for (int y = 0; y < image.height; ++y) {
    for (int x = 0; x < image.width; ++x) {
      if (x < box.x0 || x >= box.x1 || y < box.y0 || y >= box.y1) {
        std::fill_n(image.at(x, y), 4, 0.0f);
      }
    }
  }
}

// One box blur along a row or a column, averaging `left` pixels before each and `right` after it,
// transparent beyond the edges.
void boxBlur(FloatImage &image, int left, int right, bool horizontal) {
  int size = left + right + 1;
  int lines = horizontal ? image.height : image.width;
  int length = horizontal ? image.width : image.height;
  std::vector<float> line(static_cast<size_t>(length * 4));
  for (int l = 0; l < lines; ++l) {
    auto pixel = [&](int i) { return horizontal ? image.at(i, l) : image.at(l, i); };
    for (int c = 0; c < 4; ++c) {
      // The window around the first pixel: only the pixels inside the image add anything.
      double sum = 0;
      for (int i = 0; i <= std::min(right, length - 1); ++i) {
        sum += pixel(i)[c];
      }
      for (int i = 0; i < length; ++i) {
        line[static_cast<size_t>(i * 4 + c)] = static_cast<float>(sum / size);
        int leaving = i - left, entering = i + right + 1;
        sum -= leaving >= 0 && leaving < length ? pixel(leaving)[c] : 0;
        sum += entering >= 0 && entering < length ? pixel(entering)[c] : 0;
      }
    }
    for (int i = 0; i < length; ++i) {
      std::copy_n(&line[static_cast<size_t>(i * 4)], 4, pixel(i));
    }
  }
}

// Three box blurs a way approximate a Gaussian of `deviation` pixels, as SVG says: three of an odd
// size d centred, or for an even d, two of d each half a pixel off centre, one each way, and one of
// d + 1 centred.
void gaussianBlur(FloatImage &image, double deviation, bool horizontal) {
  if (deviation <= 0) {
    return;
  }
  // Past a box far wider than any image, every pixel averages to the same nothing: capped, so the
  // size stays an int.
  int d = static_cast<int>(std::min(std::floor(deviation * 3 * std::sqrt(2 * M_PI) / 4 + 0.5), double{1 << 24}));
  if (d < 1) {
    return;
  }
  if (d % 2 == 1) {
    for (int i = 0; i < 3; ++i) {
      boxBlur(image, d / 2, d / 2, horizontal);
    }
  } else {
    boxBlur(image, d / 2, d / 2 - 1, horizontal);
    boxBlur(image, d / 2 - 1, d / 2, horizontal);
    boxBlur(image, d / 2, d / 2, horizontal);
  }
}

FloatImage offset(const FloatImage &in, int dx, int dy) {
  FloatImage out = blank(in.width, in.height);
  for (int y = 0; y < in.height; ++y) {
    for (int x = 0; x < in.width; ++x) {
      int sx = x - dx, sy = y - dy;
      if (sx >= 0 && sx < in.width && sy >= 0 && sy < in.height) {
        std::copy_n(in.at(sx, sy), 4, out.at(x, y));
      }
    }
  }
  return out;
}

FloatImage colorMatrix(const FloatImage &in, const std::array<double, 20> &m) {
  FloatImage out = blank(in.width, in.height);
  for (size_t i = 0; i < in.rgba.size(); i += 4) {
    double a = in.rgba[i + 3];
    double c[4] = {a > 0 ? in.rgba[i] / a : 0, a > 0 ? in.rgba[i + 1] / a : 0, a > 0 ? in.rgba[i + 2] / a : 0, a};
    double r[4];
    for (int row = 0; row < 4; ++row) {
      const double *k = &m[static_cast<size_t>(row * 5)];
      r[row] = std::clamp(k[0] * c[0] + k[1] * c[1] + k[2] * c[2] + k[3] * c[3] + k[4], 0.0, 1.0);
    }
    for (int ch = 0; ch < 3; ++ch) {
      out.rgba[i + ch] = static_cast<float>(r[ch] * r[3]);
    }
    out.rgba[i + 3] = static_cast<float>(r[3]);
  }
  return out;
}

FloatImage composite(const FloatImage &a, const FloatImage &b, int op, const std::array<double, 4> &k) {
  FloatImage out = blank(a.width, a.height);
  for (size_t i = 0; i < a.rgba.size(); i += 4) {
    double aa = a.rgba[i + 3], ba = b.rgba[i + 3];
    for (int ch = 0; ch < 4; ++ch) {
      double A = a.rgba[i + ch], B = b.rgba[i + ch], v = 0;
      switch (op) {
        case 1:
          v = A * ba;
          break;
        case 2:
          v = A * (1 - ba);
          break;
        case 3:
          v = A * ba + B * (1 - aa);
          break;
        case 4:
          v = A * (1 - ba) + B * (1 - aa);
          break;
        case 5:
          v = k[0] * A * B + k[1] * A + k[2] * B + k[3];
          break;
        default:
          v = A + B * (1 - aa);
          break;
      }
      out.rgba[i + ch] = static_cast<float>(std::clamp(v, 0.0, 1.0));
    }
    // Arithmetic can make colour beyond its alpha: premultiplied colour never exceeds it.
    for (int ch = 0; ch < 3; ++ch) {
      out.rgba[i + ch] = std::min(out.rgba[i + ch], out.rgba[i + 3]);
    }
  }
  return out;
}

} // namespace

SvgPixels runSvgFilter(const SvgFilter &filter, const SvgPixels &source, const SvgMatrix &toPixels) {
  int width = source.width, height = source.height;
  std::unordered_map<std::string, FloatImage> results;
  FloatImage graphic = blank(width, height);
  for (size_t i = 0; i < graphic.rgba.size() && i < source.rgba.size(); ++i) {
    graphic.rgba[i] = source.rgba[i] / 255.0f;
  }
  FloatImage alpha = blank(width, height);
  for (size_t i = 3; i < graphic.rgba.size(); i += 4) {
    alpha.rgba[i] = graphic.rgba[i];
  }
  results.emplace("SourceGraphic", std::move(graphic));
  results.emplace("SourceAlpha", std::move(alpha));
  auto input = [&](const std::string &name) {
    auto found = results.find(name);
    return found != results.end() ? found->second : blank(width, height);
  };
  // How far a user unit goes each way in pixels, for lengths that have no direction.
  double scaleX = std::hypot(toPixels.a, toPixels.b), scaleY = std::hypot(toPixels.c, toPixels.d);
  FloatImage last = blank(width, height);
  for (const auto &step : filter.steps) {
    FloatImage out;
    switch (step.type) {
      case SvgFilterStep::Type::GaussianBlur:
        out = input(step.in1);
        gaussianBlur(out, step.stdDeviationX * scaleX, true);
        gaussianBlur(out, step.stdDeviationY * scaleY, false);
        break;
      case SvgFilterStep::Type::Offset: {
        double dx = toPixels.a * step.dx + toPixels.c * step.dy, dy = toPixels.b * step.dx + toPixels.d * step.dy;
        out = offset(input(step.in1), static_cast<int>(std::lround(dx)), static_cast<int>(std::lround(dy)));
        break;
      }
      case SvgFilterStep::Type::ColorMatrix:
        out = colorMatrix(input(step.in1), step.matrix);
        break;
      case SvgFilterStep::Type::Flood: {
        out = blank(width, height);
        float a = static_cast<float>(((step.argb >> 24) & 0xff) / 255.0 * step.opacity);
        float c[4] = {((step.argb >> 16) & 0xff) / 255.0f * a, ((step.argb >> 8) & 0xff) / 255.0f * a, (step.argb & 0xff) / 255.0f * a, a};
        for (size_t i = 0; i < out.rgba.size(); i += 4) {
          std::copy_n(c, 4, &out.rgba[i]);
        }
        break;
      }
      case SvgFilterStep::Type::Composite:
        out = composite(input(step.in1), input(step.in2), step.op, step.k);
        break;
      case SvgFilterStep::Type::Merge:
        out = blank(width, height);
        for (const auto &name : step.inputs) {
          out = composite(input(name), out, 0, {});
        }
        break;
    }
    cut(out, pixelBox(step.subregion, toPixels, width, height));
    results[step.result] = out;
    last = std::move(out);
  }
  cut(last, pixelBox(filter.region, toPixels, width, height));
  SvgPixels result{.width = width, .height = height, .rgba = std::vector<uint8_t>(last.rgba.size())};
  for (size_t i = 0; i < last.rgba.size(); ++i) {
    result.rgba[i] = static_cast<uint8_t>(std::lround(std::clamp(last.rgba[i], 0.0f, 1.0f) * 255));
  }
  return result;
}

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
