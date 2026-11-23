#include "ngn/svg-markup.h"

#include "ngn/bytes.h"

#include <folly/dynamic.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <map>
#include <utility>
#include <vector>

namespace ngn {

namespace {

// --- the markup as elements ---------------------------------------------------------------------

struct XmlElement {
  std::string tag;
  std::map<std::string, std::string> attrs;
  std::vector<XmlElement> children;
};

// Deeper than any icon nests, and shallow enough that markup from a server cannot overflow the stack.
constexpr int kMaxDepth = 64;

bool isSpace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

std::string trimmed(std::string_view text) {
  size_t begin = 0, end = text.size();
  while (begin < end && isSpace(text[begin])) {
    begin++;
  }
  while (end > begin && isSpace(text[end - 1])) {
    end--;
  }
  return std::string(text.substr(begin, end - begin));
}

std::string lowered(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return std::tolower(c); });
  return text;
}

void appendUtf8(std::string &out, uint32_t code) {
  if (code < 0x80) {
    out += static_cast<char>(code);
  } else if (code < 0x800) {
    out += static_cast<char>(0xc0 | (code >> 6));
    out += static_cast<char>(0x80 | (code & 0x3f));
  } else if (code < 0x10000) {
    out += static_cast<char>(0xe0 | (code >> 12));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3f));
    out += static_cast<char>(0x80 | (code & 0x3f));
  } else if (code < 0x110000) {
    out += static_cast<char>(0xf0 | (code >> 18));
    out += static_cast<char>(0x80 | ((code >> 12) & 0x3f));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3f));
    out += static_cast<char>(0x80 | (code & 0x3f));
  }
}

// An attribute's value with XML's five entities and character references read.
std::string unescaped(std::string_view text) {
  static const std::map<std::string_view, char> named = {{"amp", '&'}, {"lt", '<'}, {"gt", '>'}, {"quot", '"'}, {"apos", '\''}};
  std::string out;
  for (size_t i = 0; i < text.size(); i++) {
    size_t end = text[i] == '&' ? text.find(';', i) : std::string_view::npos;
    if (end == std::string_view::npos) {
      out += text[i];
      continue;
    }
    auto name = text.substr(i + 1, end - i - 1);
    if (auto found = named.find(name); found != named.end()) {
      out += found->second;
    } else if (name.size() > 1 && name[0] == '#') {
      bool hex = name[1] == 'x' || name[1] == 'X';
      std::string digits(name.substr(hex ? 2 : 1));
      char *stop = nullptr;
      unsigned long code = std::strtoul(digits.c_str(), &stop, hex ? 16 : 10);
      if (digits.empty() || *stop != '\0') {
        out += text[i];
        continue;
      }
      appendUtf8(out, static_cast<uint32_t>(code));
    } else {
      out += text[i];
      continue;
    }
    i = end;
  }
  return out;
}

class XmlReader {
 public:
  explicit XmlReader(std::string_view text) : text_(text) {}

  // The document's element, after any declaration, comments and doctype.
  std::optional<XmlElement> document() {
    skipMisc();
    if (!at("<")) {
      return std::nullopt;
    }
    return element(0);
  }

 private:
  bool at(std::string_view s) const {
    return text_.substr(pos_, s.size()) == s;
  }

  void skipSpace() {
    while (pos_ < text_.size() && isSpace(text_[pos_])) {
      pos_++;
    }
  }

  // Past `end`, or to the end of the text when it never comes.
  void skipPast(std::string_view end) {
    size_t found = text_.find(end, pos_);
    pos_ = found == std::string_view::npos ? text_.size() : found + end.size();
  }

  // Comments, processing instructions and a doctype, between elements.
  void skipMisc() {
    for (;;) {
      skipSpace();
      if (at("<!--")) {
        skipPast("-->");
      } else if (at("<?")) {
        skipPast("?>");
      } else if (at("<!") && !at("<![CDATA[")) {
        skipPast(">");
      } else {
        return;
      }
    }
  }

  std::string name() {
    size_t begin = pos_;
    while (pos_ < text_.size() && !isSpace(text_[pos_]) && text_[pos_] != '/' && text_[pos_] != '>' && text_[pos_] != '=') {
      pos_++;
    }
    auto read = text_.substr(begin, pos_ - begin);
    // `svg:path` is a path: an icon's elements are all SVG's.
    if (auto colon = read.find(':'); colon != std::string_view::npos && read.substr(0, colon) != "xmlns" &&
                                      read.substr(0, colon) != "xlink" && read.substr(0, colon) != "xml") {
      read = read.substr(colon + 1);
    }
    return std::string(read);
  }

  std::optional<XmlElement> element(int depth) {
    if (depth > kMaxDepth) {
      return std::nullopt;
    }
    pos_++; // <
    XmlElement e{.tag = name()};
    if (e.tag.empty()) {
      return std::nullopt;
    }
    for (;;) {
      skipSpace();
      if (pos_ >= text_.size()) {
        return std::nullopt;
      }
      if (at("/>")) {
        pos_ += 2;
        return e;
      }
      if (at(">")) {
        pos_++;
        break;
      }
      auto attr = name();
      skipSpace();
      if (attr.empty() || !at("=")) {
        return std::nullopt;
      }
      pos_++;
      skipSpace();
      if (pos_ >= text_.size() || (text_[pos_] != '"' && text_[pos_] != '\'')) {
        return std::nullopt;
      }
      char quote = text_[pos_++];
      size_t end = text_.find(quote, pos_);
      if (end == std::string_view::npos) {
        return std::nullopt;
      }
      e.attrs[attr] = unescaped(text_.substr(pos_, end - pos_));
      pos_ = end + 1;
    }
    for (;;) {
      if (pos_ >= text_.size()) {
        return std::nullopt;
      }
      if (at("</")) {
        skipPast(">");
        return e;
      }
      if (at("<!--")) {
        skipPast("-->");
      } else if (at("<![CDATA[")) {
        skipPast("]]>");
      } else if (at("<?")) {
        skipPast("?>");
      } else if (at("<")) {
        auto child = element(depth + 1);
        if (!child) {
          return std::nullopt;
        }
        e.children.push_back(std::move(*child));
      } else {
        // Text: an icon's shapes have none worth drawing.
        size_t next = text_.find('<', pos_);
        pos_ = next == std::string_view::npos ? text_.size() : next;
      }
    }
  }

  std::string_view text_;
  size_t pos_{0};
};

// --- values -------------------------------------------------------------------------------------

// The numbers in a list such as a viewBox, a points list or a transform's arguments.
std::vector<double> numbers(std::string_view text) {
  std::vector<double> out;
  std::string copy(text);
  const char *p = copy.c_str();
  while (*p != '\0') {
    while (*p != '\0' && (isSpace(*p) || *p == ',')) {
      p++;
    }
    if (*p == '\0') {
      break;
    }
    char *end = nullptr;
    double value = std::strtod(p, &end);
    if (end == p) {
      break;
    }
    out.push_back(value);
    p = end;
  }
  return out;
}

// A value with each `var(--name, fallback)` taken as its fallback; nothing for a `var()` without one.
std::optional<std::string> withoutVars(std::string value) {
  for (int guard = 0; guard < 16; guard++) {
    size_t start = value.find("var(");
    if (start == std::string::npos) {
      return trimmed(value);
    }
    int depth = 0;
    size_t comma = std::string::npos, close = std::string::npos;
    for (size_t i = start + 4; i < value.size(); i++) {
      if (value[i] == '(') {
        depth++;
      } else if (value[i] == ')') {
        if (depth == 0) {
          close = i;
          break;
        }
        depth--;
      } else if (value[i] == ',' && depth == 0 && comma == std::string::npos) {
        comma = i;
      }
    }
    if (close == std::string::npos || comma == std::string::npos) {
      return std::nullopt;
    }
    value = value.substr(0, start) + trimmed(std::string_view(value).substr(comma + 1, close - comma - 1)) + value.substr(close + 1);
  }
  return std::nullopt;
}

int hexDigit(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
}

uint32_t argb(double r, double g, double b, double a) {
  auto channel = [](double v) { return static_cast<uint32_t>(std::lround(std::clamp(v, 0.0, 255.0))); };
  return channel(a * 255) << 24 | channel(r) << 16 | channel(g) << 8 | channel(b);
}

// A colour as `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` or `transparent`. Another
// named colour is black: the icon is painted in one colour, so only whether and how opaquely a
// shape paints is read from it.
std::optional<uint32_t> colorOf(const std::string &value) {
  auto text = lowered(value);
  if (text == "transparent") {
    return 0;
  }
  if (text.size() > 1 && text[0] == '#') {
    std::vector<int> digits;
    for (size_t i = 1; i < text.size(); i++) {
      int d = hexDigit(text[i]);
      if (d < 0) {
        return std::nullopt;
      }
      digits.push_back(d);
    }
    auto pair = [&](size_t i) { return digits[i] * 16 + digits[i + 1]; };
    switch (digits.size()) {
      case 3:
      case 4:
        return argb(digits[0] * 17, digits[1] * 17, digits[2] * 17, digits.size() == 4 ? digits[3] * 17 / 255.0 : 1);
      case 6:
      case 8:
        return argb(pair(0), pair(2), pair(4), digits.size() == 8 ? pair(6) / 255.0 : 1);
      default:
        return std::nullopt;
    }
  }
  if (text.rfind("rgb", 0) == 0) {
    auto open = text.find('(');
    auto values = numbers(open == std::string::npos ? "" : std::string_view(text).substr(open + 1));
    if (values.size() < 3) {
      return std::nullopt;
    }
    bool percent = text.find('%') != std::string::npos;
    double scale = percent ? 2.55 : 1;
    double alpha = values.size() > 3 ? values[3] : 1;
    return argb(values[0] * scale, values[1] * scale, values[2] * scale, std::clamp(alpha, 0.0, 1.0));
  }
  if (!text.empty() && std::all_of(text.begin(), text.end(), [](unsigned char c) { return std::isalpha(c); })) {
    return 0xff000000;
  }
  return std::nullopt;
}

std::optional<SvgBrush> brushOf(const std::string &value) {
  auto text = lowered(value);
  if (text == "none") {
    return SvgBrush{.type = SvgBrush::Type::None};
  }
  if (text == "currentcolor") {
    return SvgBrush{.type = SvgBrush::Type::CurrentColor};
  }
  if (text.rfind("url(", 0) == 0) {
    auto close = value.find(')');
    auto ref = trimmed(std::string_view(value).substr(4, close == std::string::npos ? std::string::npos : close - 4));
    ref.erase(std::remove(ref.begin(), ref.end(), '\''), ref.end());
    ref.erase(std::remove(ref.begin(), ref.end(), '"'), ref.end());
    if (!ref.empty() && ref[0] == '#') {
      ref.erase(0, 1);
    }
    return SvgBrush{.type = SvgBrush::Type::Ref, .ref = ref};
  }
  if (auto color = colorOf(value)) {
    return SvgBrush{.type = SvgBrush::Type::Color, .argb = *color};
  }
  return std::nullopt;
}

std::optional<double> opacityOf(const std::string &value) {
  char *end = nullptr;
  double number = std::strtod(value.c_str(), &end);
  if (end == value.c_str()) {
    return std::nullopt;
  }
  return std::clamp(trimmed(end) == "%" ? number / 100 : number, 0.0, 1.0);
}

std::optional<SvgMatrix> transformOf(const std::string &value) {
  SvgMatrix total;
  bool any = false;
  size_t pos = 0;
  while (pos < value.size()) {
    size_t open = value.find('(', pos);
    size_t close = open == std::string::npos ? std::string::npos : value.find(')', open);
    if (close == std::string::npos) {
      break;
    }
    auto kind = trimmed(std::string_view(value).substr(pos, open - pos));
    kind.erase(std::remove(kind.begin(), kind.end(), ','), kind.end());
    kind = trimmed(kind);
    auto args = numbers(std::string_view(value).substr(open + 1, close - open - 1));
    pos = close + 1;
    auto arg = [&](size_t i, double fallback) { return i < args.size() ? args[i] : fallback; };
    SvgMatrix m;
    constexpr double radians = M_PI / 180;
    if (kind == "matrix" && args.size() == 6) {
      m = {args[0], args[1], args[2], args[3], args[4], args[5]};
    } else if (kind == "translate" && !args.empty()) {
      m = SvgMatrix::translate(args[0], arg(1, 0));
    } else if (kind == "scale" && !args.empty()) {
      m = SvgMatrix::scale(args[0], arg(1, args[0]));
    } else if (kind == "rotate" && !args.empty()) {
      double a = args[0] * radians, cx = arg(1, 0), cy = arg(2, 0);
      m = SvgMatrix::translate(cx, cy) * SvgMatrix{std::cos(a), std::sin(a), -std::sin(a), std::cos(a), 0, 0} *
          SvgMatrix::translate(-cx, -cy);
    } else if (kind == "skewX" && !args.empty()) {
      m = {1, 0, std::tan(args[0] * radians), 1, 0, 0};
    } else if (kind == "skewY" && !args.empty()) {
      m = {1, std::tan(args[0] * radians), 0, 1, 0, 0};
    } else {
      continue;
    }
    total = total * m;
    any = true;
  }
  return any ? std::optional<SvgMatrix>(total) : std::nullopt;
}

SvgLength lengthOf(const std::string &value) {
  return svgLength(folly::dynamic(value));
}

// --- elements -----------------------------------------------------------------------------------

// An element's attributes with the declarations of its `style`, which win.
std::map<std::string, std::string> declared(const XmlElement &e) {
  auto attrs = e.attrs;
  auto style = e.attrs.find("style");
  if (style == e.attrs.end()) {
    return attrs;
  }
  std::string_view text = style->second;
  size_t pos = 0;
  while (pos < text.size()) {
    size_t end = text.find(';', pos);
    auto declaration = text.substr(pos, end == std::string_view::npos ? std::string_view::npos : end - pos);
    pos = end == std::string_view::npos ? text.size() : end + 1;
    size_t colon = declaration.find(':');
    if (colon == std::string_view::npos) {
      continue;
    }
    auto name = lowered(trimmed(declaration.substr(0, colon)));
    auto value = trimmed(declaration.substr(colon + 1));
    if (auto important = value.find("!important"); important != std::string::npos) {
      value = trimmed(std::string_view(value).substr(0, important));
    }
    if (!name.empty()) {
      attrs[name] = value;
    }
  }
  return attrs;
}

// The presentation an element sets, each listed in `propList` so its children inherit it as
// react-native-svg's elements do.
void presentation(SvgElement &e, const std::map<std::string, std::string> &attrs) {
  auto value = [&](const char *name) -> std::optional<std::string> {
    auto found = attrs.find(name);
    if (found == attrs.end()) {
      return std::nullopt;
    }
    auto resolved = withoutVars(found->second);
    if (!resolved || resolved->empty() || *resolved == "inherit") {
      return std::nullopt;
    }
    return resolved;
  };
  auto list = [&](const char *name) { e.propList.emplace_back(name); };
  auto keyword = [](const std::string &v, std::initializer_list<const char *> names) -> std::optional<int> {
    int i = 0;
    for (const char *name : names) {
      if (v == name) {
        return i;
      }
      i++;
    }
    return std::nullopt;
  };

  if (auto v = value("fill")) {
    if (auto brush = brushOf(*v)) {
      e.fill = *brush;
      list("fill");
    }
  }
  if (auto v = value("stroke")) {
    if (auto brush = brushOf(*v)) {
      e.stroke = *brush;
      list("stroke");
    }
  }
  if (auto v = value("color")) {
    if (auto color = colorOf(*v)) {
      e.color = *color;
    }
  }
  if (auto v = value("fill-opacity"); v && opacityOf(*v)) {
    e.fillOpacity = *opacityOf(*v);
    list("fillOpacity");
  }
  if (auto v = value("stroke-opacity"); v && opacityOf(*v)) {
    e.strokeOpacity = *opacityOf(*v);
    list("strokeOpacity");
  }
  if (auto v = value("opacity"); v && opacityOf(*v)) {
    e.opacity = *opacityOf(*v);
  }
  if (auto v = value("fill-rule")) {
    if (auto rule = keyword(*v, {"evenodd", "nonzero"})) {
      e.fillRule = *rule;
      list("fillRule");
    }
  }
  if (auto v = value("stroke-width"); v && lengthOf(*v).set) {
    e.strokeWidth = lengthOf(*v);
    list("strokeWidth");
  }
  if (auto v = value("stroke-linecap")) {
    if (auto cap = keyword(*v, {"butt", "round", "square"})) {
      e.strokeLinecap = *cap;
      list("strokeLinecap");
    }
  }
  if (auto v = value("stroke-linejoin")) {
    if (auto join = keyword(*v, {"miter", "round", "bevel"})) {
      e.strokeLinejoin = *join;
      list("strokeLinejoin");
    }
  }
  if (auto v = value("stroke-miterlimit"); v && !numbers(*v).empty()) {
    e.strokeMiterlimit = numbers(*v)[0];
    list("strokeMiterlimit");
  }
  if (auto v = value("stroke-dasharray")) {
    e.strokeDasharray.clear();
    if (*v != "none") {
      for (double d : numbers(*v)) {
        e.strokeDasharray.push_back({.value = d, .set = true});
      }
    }
    list("strokeDasharray");
  }
  if (auto v = value("stroke-dashoffset"); v && !numbers(*v).empty()) {
    e.strokeDashoffset = numbers(*v)[0];
    list("strokeDashoffset");
  }
  if (auto v = value("display"); v && *v == "none") {
    e.hidden = true;
  }
  if (auto v = value("visibility"); v && (*v == "hidden" || *v == "collapse")) {
    e.hidden = true;
  }
}

// `points` as path data, closed for a polygon.
std::string pathOfPoints(const std::string &points, bool close) {
  auto values = numbers(points);
  std::string d;
  for (size_t i = 0; i + 1 < values.size(); i += 2) {
    d += (i == 0 ? "M" : "L") + std::to_string(values[i]) + "," + std::to_string(values[i + 1]);
  }
  return d.empty() || !close ? d : d + "Z";
}

std::optional<SvgNode> nodeOf(const XmlElement &x) {
  static const std::map<std::string, SvgKind> kinds = {
      {"g", SvgKind::Group},
      {"a", SvgKind::Group},
      {"path", SvgKind::Path},
      {"rect", SvgKind::Rect},
      {"circle", SvgKind::Circle},
      {"ellipse", SvgKind::Ellipse},
      {"line", SvgKind::Line},
      {"polyline", SvgKind::Path},
      {"polygon", SvgKind::Path},
  };
  auto kind = kinds.find(x.tag);
  if (kind == kinds.end()) {
    return std::nullopt;
  }
  auto attrs = declared(x);
  SvgNode node{.element = {.kind = kind->second}};
  auto &e = node.element;
  presentation(e, attrs);
  if (auto t = attrs.find("transform"); t != attrs.end()) {
    e.matrix = transformOf(t->second);
  }
  auto lengths = [&](std::initializer_list<const char *> names) {
    for (const char *name : names) {
      if (auto found = attrs.find(name); found != attrs.end()) {
        if (auto length = lengthOf(found->second); length.set) {
          e.lengths[name] = length;
        }
      }
    }
  };
  switch (e.kind) {
    case SvgKind::Path:
      e.d = x.tag == "path" ? attrs["d"] : pathOfPoints(attrs["points"], x.tag == "polygon");
      break;
    case SvgKind::Rect:
      lengths({"x", "y", "width", "height", "rx", "ry"});
      break;
    case SvgKind::Circle:
      lengths({"cx", "cy", "r"});
      break;
    case SvgKind::Ellipse:
      lengths({"cx", "cy", "rx", "ry"});
      break;
    case SvgKind::Line:
      lengths({"x1", "y1", "x2", "y2"});
      break;
    default:
      for (const auto &child : x.children) {
        if (auto drawn = nodeOf(child)) {
          node.children.push_back(std::move(*drawn));
        }
      }
      break;
  }
  return node;
}

void paint(SvgNode &node, uint32_t color) {
  auto &e = node.element;
  auto repaint = [&](SvgBrush &brush) {
    using T = SvgBrush::Type;
    if (brush.type == T::Color) {
      double alpha = (brush.argb >> 24) / 255.0 * (color >> 24) / 255.0;
      brush.argb = (static_cast<uint32_t>(std::lround(alpha * 255)) << 24) | (color & 0xffffff);
    } else if (brush.type == T::CurrentColor || brush.type == T::Ref) {
      brush = {.type = T::Color, .argb = color};
    }
  };
  repaint(e.fill);
  repaint(e.stroke);
  if (e.color) {
    e.color = color;
  }
  for (auto &child : node.children) {
    paint(child, color);
  }
}

} // namespace

std::optional<SvgDocument> parseSvgMarkup(std::string_view markup) {
  auto root = XmlReader(markup).document();
  if (!root || root->tag != "svg") {
    return std::nullopt;
  }
  auto attrs = declared(*root);
  SvgElement svg{.kind = SvgKind::Svg};
  svg.align = "xMidYMid";
  if (auto box = numbers(attrs["viewBox"]); box.size() == 4 && box[2] > 0 && box[3] > 0) {
    svg.minX = box[0];
    svg.minY = box[1];
    svg.vbWidth = box[2];
    svg.vbHeight = box[3];
  }
  if (attrs.contains("preserveAspectRatio")) {
    std::string text = trimmed(attrs["preserveAspectRatio"]);
    auto space = text.find(' ');
    svg.align = text.substr(0, space);
    svg.meetOrSlice = space != std::string::npos && trimmed(std::string_view(text).substr(space)) == "slice" ? 1 : 0;
  }
  if (auto color = attrs.find("color"); color != attrs.end()) {
    svg.color = colorOf(color->second);
  }
  // The svg view holds no paint, so the root's presentation goes on a group around its children,
  // as react-native-svg's Svg does it.
  SvgNode group{.element = {.kind = SvgKind::Group}};
  presentation(group.element, attrs);
  group.element.opacity = 1;
  group.element.color.reset();
  for (const auto &child : root->children) {
    if (auto drawn = nodeOf(child)) {
      group.children.push_back(std::move(*drawn));
    }
  }
  SvgDocument document{.root = {.element = std::move(svg)}};
  document.root.children.push_back(std::move(group));
  return document;
}

SvgDocument svgPaintedIn(const SvgDocument &document, uint32_t argb) {
  SvgDocument painted = document;
  painted.root.element.color = argb;
  for (auto &child : painted.root.children) {
    // A shape that sets no fill fills black, which would be the one colour not tinted.
    auto &list = child.element.propList;
    if (std::find(list.begin(), list.end(), "fill") == list.end()) {
      child.element.fill = {.type = SvgBrush::Type::CurrentColor};
      list.emplace_back("fill");
    }
    paint(child, argb);
  }
  return painted;
}

std::optional<std::string> svgMarkupOfUri(std::string_view uri) {
  constexpr std::string_view prefix = "data:image/svg+xml";
  size_t comma = uri.find(',');
  if (uri.substr(0, prefix.size()) != prefix || comma == std::string_view::npos) {
    return std::nullopt;
  }
  auto header = uri.substr(prefix.size(), comma - prefix.size());
  std::string data(uri.substr(comma + 1));
  if (header.find(";base64") != std::string_view::npos) {
    return base64Decode(data);
  }
  std::string out;
  for (size_t i = 0; i < data.size(); i++) {
    int high = i + 2 < data.size() && data[i] == '%' ? hexDigit(data[i + 1]) : -1;
    int low = high >= 0 ? hexDigit(data[i + 2]) : -1;
    if (low >= 0) {
      out += static_cast<char>(high * 16 + low);
      i += 2;
    } else {
      out += data[i];
    }
  }
  return out;
}

} // namespace ngn
