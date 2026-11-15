// SVG as react-native-svg commits it: its host components' props read into a toolkit-free model,
// the path and paint model, and the drawing of a document onto a narrow canvas.
//
// react-native-svg mounts one view per element (RNSVGSvgView with RNSVGGroup, RNSVGPath and the
// rest under it). The core keeps each svg's elements as a document (SvgDrawings, below), and the
// backend's view for the RNSVGSvgView draws it by calling drawSvg with an SvgCanvas over its own
// graphics context. Everything SVG means (inheritance through `propList`, `currentColor`,
// lengths and percentages, the viewBox, path data and arcs, gradients and their units, clip
// paths, masks, `use` and `symbol`, markers, patterns and filters) is decided here; the canvas only
// draws paths, gradients, images and runs of text, tiles a pattern's tile, and runs a filter's
// steps over pixels with runSvgFilter.
#pragma once

#include "ngn/view-tree.h"

#include <react/renderer/core/Props.h>

#include <folly/dynamic.h>

#include <array>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ngn {

// An affine transform, as SVG's matrix(a b c d e f): x' = a*x + c*y + e, y' = b*x + d*y + f.
struct SvgMatrix {
  double a{1}, b{0}, c{0}, d{1}, e{0}, f{0};

  static SvgMatrix translate(double x, double y) { return {1, 0, 0, 1, x, y}; }
  static SvgMatrix scale(double x, double y) { return {x, 0, 0, y, 0, 0}; }
  // This transform applied after `inner`: (this * inner)(p) == this(inner(p)).
  SvgMatrix operator*(const SvgMatrix &inner) const;
  std::pair<double, double> apply(double x, double y) const;
  bool operator==(const SvgMatrix &) const = default;
};

struct SvgRect {
  double x{0}, y{0}, width{0}, height{0};
  bool operator==(const SvgRect &) const = default;
};

// A path as moves, lines, cubic curves and closes: quadratics, smooth curves and arcs are
// converted as they are parsed.
struct SvgPath {
  enum class Op { Move, Line, Cubic, Close };
  struct Segment {
    Op op;
    // One point for Move and Line, three for Cubic (two controls, then the end), none for Close.
    double points[6]{};
    bool operator==(const Segment &) const = default;
  };
  std::vector<Segment> segments;

  void moveTo(double x, double y);
  void lineTo(double x, double y);
  void cubicTo(double x1, double y1, double x2, double y2, double x, double y);
  void close();
  void append(const SvgPath &other, const SvgMatrix &transform);
  bool empty() const { return segments.empty(); }
  // The control-point bounds, which contain the curve; nothing for a path with no points.
  std::optional<SvgRect> bounds() const;
  bool operator==(const SvgPath &) const = default;
};

// SVG path data (`d`). Parsing stops at the first error, keeping what came before it, as browsers
// draw a path up to its first bad command.
SvgPath parseSvgPath(const std::string &d);

// A length as react-native-svg sends one: a number in user units, or a string with a unit.
struct SvgLength {
  enum class Unit { User, Percent, Em };
  double value{0};
  Unit unit{Unit::User};
  bool set{false};
  bool operator==(const SvgLength &) const = default;
};
SvgLength svgLength(const folly::dynamic &value);
std::vector<SvgLength> svgLengths(const folly::dynamic &value);

// A fill or stroke: react-native-svg's brush ({type: 0, payload: color}, {type: 1, brushRef},
// {type: 2} for currentColor), or nothing set.
struct SvgBrush {
  enum class Type { Unset, None, Color, CurrentColor, Ref };
  Type type{Type::Unset};
  uint32_t argb{0xff000000};
  std::string ref;
  bool operator==(const SvgBrush &) const = default;
};
SvgBrush svgBrush(const folly::dynamic &value);

enum class SvgKind {
  Svg,
  Group,
  Path,
  Rect,
  Circle,
  Ellipse,
  Line,
  Use,
  Defs,
  LinearGradient,
  RadialGradient,
  ClipPath,
  Mask,
  Symbol,
  Image,
  Text,
  TSpan,
  Marker,
  Pattern,
  Filter,
  // A filter's steps.
  FeGaussianBlur,
  FeOffset,
  FeColorMatrix,
  FeFlood,
  FeComposite,
  FeMerge,
};

// One element's props, from its host component's.
struct SvgElement {
  SvgKind kind{SvgKind::Group};
  std::string name;

  // Presentation. An attribute in `propList` is the element's own; any other is inherited from
  // its parent where the parent has it, as react-native-svg merges them.
  std::vector<std::string> propList;
  SvgBrush fill;
  double fillOpacity{1};
  int fillRule{1}; // 0 evenodd, 1 nonzero
  SvgBrush stroke;
  double strokeOpacity{1};
  SvgLength strokeWidth;
  int strokeLinecap{0}; // butt, round, square
  int strokeLinejoin{0}; // miter, round, bevel
  std::vector<SvgLength> strokeDasharray;
  double strokeDashoffset{0};
  double strokeMiterlimit{4};
  // `currentColor` for this element and what it contains, when it sets one.
  std::optional<uint32_t> color;

  double opacity{1};
  std::optional<SvgMatrix> matrix;
  std::string clipPath;
  int clipRule{1};
  std::string mask;
  // The filter the element draws through, and the markers a shape draws at its vertices.
  std::string filter;
  std::string markerStart, markerMid, markerEnd;
  bool hidden{false}; // display: none

  // Geometry and positions by attribute name: x, y, width, height, rx, ry, cx, cy, r, x1, y1, x2,
  // y2, fx, fy; a marker's refX, refY, markerWidth and markerHeight; an offset's dx and dy.
  std::map<std::string, SvgLength> lengths;
  std::string d;
  std::string href;

  // A gradient's stops (offset, ARGB), and its units (0 objectBoundingBox, 1 userSpaceOnUse); a
  // mask's, a pattern's and a filter's units and content units the same way (a filter's content
  // units are its primitiveUnits), and a mask's type (0 luminance, 1 alpha).
  std::vector<std::pair<double, uint32_t>> stops;
  int units{0};
  int contentUnits{1};
  int maskType{0};
  // A gradient's gradientTransform or a pattern's patternTransform.
  std::optional<SvgMatrix> gradientTransform;

  // A marker's markerUnits ("strokeWidth", the default, or "userSpaceOnUse") and orient ("auto",
  // "auto-start-reverse" or an angle in degrees).
  std::string markerUnits;
  std::string orient;

  // A filter step: its inputs (SourceGraphic, SourceAlpha or an earlier step's result) and its own
  // result's name; a colour matrix's type (0 matrix, 1 saturate, 2 hueRotate, 3 luminanceToAlpha)
  // and values; a composite's operator (0 over, 1 in, 2 out, 3 atop, 4 xor, 5 arithmetic) and k1
  // to k4; a blur's deviations; a flood's colour; a merge's inputs.
  std::string in1, in2, result;
  int op{0};
  std::vector<double> values;
  std::array<double, 4> k{};
  double stdDeviationX{0}, stdDeviationY{0};
  SvgBrush flood{.type = SvgBrush::Type::Color, .argb = 0xff000000};
  double floodOpacity{1};
  std::vector<std::string> nodes;

  // The viewBox of an svg or a symbol, and how it fits; an image's fit uses align too.
  double minX{0}, minY{0}, vbWidth{0}, vbHeight{0};
  std::string align;
  int meetOrSlice{0}; // meet, slice
  SvgLength bbWidth, bbHeight;

  std::string uri; // an image's source

  // Text: a span's characters, the font, and the positions written on the element.
  std::string content;
  SvgLength fontSize;
  std::string fontFamily;
  std::string fontWeight;
  std::vector<SvgLength> xs, ys, dxs, dys;

  bool operator==(const SvgElement &) const = default;
};

struct SvgNode {
  SvgElement element;
  std::vector<SvgNode> children;
  bool operator==(const SvgNode &) const = default;
};

// An svg and everything under it, as one RNSVGSvgView holds it.
struct SvgDocument {
  SvgNode root;
  bool operator==(const SvgDocument &) const = default;
};

// The transform that fits a viewBox into a viewport, as preserveAspectRatio says: `align` is
// "none" or xMin|xMid|xMax with YMin|YMid|YMax, and meetOrSlice 0 fits it in, 1 covers.
SvgMatrix svgViewBoxTransform(const SvgRect &viewBox, const std::string &align, int meetOrSlice, double width, double height);

// A gradient in user space, ready to draw.
struct SvgGradient {
  bool radial{false};
  // Linear: from (x1, y1) to (x2, y2). Radial: centre (x1, y1), focus (x2, y2), radius r.
  double x1{0}, y1{0}, x2{0}, y2{0}, r{0};
  std::vector<std::pair<double, uint32_t>> stops;
  // From the gradient's own space to the user space it paints in.
  SvgMatrix transform;
  bool operator==(const SvgGradient &) const = default;
};

struct SvgPaint {
  // A colour, or a gradient when `gradient` is set.
  uint32_t argb{0xff000000};
  std::optional<SvgGradient> gradient;
  double opacity{1};
  bool operator==(const SvgPaint &) const = default;
};

struct SvgStroke {
  double width{1};
  int cap{0};
  int join{0};
  double miterLimit{4};
  std::vector<double> dashes;
  double dashOffset{0};
  bool operator==(const SvgStroke &) const = default;
};

// A marker drawn at a vertex of a shape: where, and its direction in degrees (SVG's `auto`), the
// bisector of the incoming and outgoing directions at a vertex between two segments.
struct SvgMarkerVertex {
  enum class Place { Start, Mid, End };
  Place place{Place::Mid};
  double x{0}, y{0};
  double angle{0};
  bool operator==(const SvgMarkerVertex &) const = default;
};
// The vertices a path's markers are drawn at, in order: the first is the start, the last the end.
std::vector<SvgMarkerVertex> svgMarkerVertices(const SvgPath &path);

// A pattern's tile: what one tile covers in the pattern's own space, and from that space to the
// user space the pattern fills.
struct SvgPatternTile {
  SvgRect tile;
  SvgMatrix transform;
  bool operator==(const SvgPatternTile &) const = default;
};

// A filter step as runSvgFilter runs it, its lengths in the user space of the element filtered.
struct SvgFilterStep {
  enum class Type { GaussianBlur, Offset, ColorMatrix, Flood, Composite, Merge };
  Type type{Type::Offset};
  // Never empty: an input left out is the step before's result, or SourceGraphic for the first.
  std::string in1, in2;
  // What later steps name this one's result by: its own `result`, or "#" and its index.
  std::string result;
  std::vector<std::string> inputs; // a merge's
  // Where the step draws; nothing outside it.
  SvgRect subregion;
  double stdDeviationX{0}, stdDeviationY{0};
  double dx{0}, dy{0};
  // A 4x5 colour matrix by rows (r, g, b, a), over unpremultiplied colour, its last column an
  // offset in 0 to 1.
  std::array<double, 20> matrix{};
  uint32_t argb{0};
  double opacity{1};
  int op{0};
  std::array<double, 4> k{};
  bool operator==(const SvgFilterStep &) const = default;
};

struct SvgFilter {
  // The filter region, in the element's user space: the result is cut to it.
  SvgRect region;
  std::vector<SvgFilterStep> steps;
  bool operator==(const SvgFilter &) const = default;
};

// A colour matrix step's 4x5 matrix for its type and values, as SVG defines saturate, hueRotate
// and luminanceToAlpha; the identity for a `matrix` without 20 values.
std::array<double, 20> svgColorMatrix(int type, const std::vector<double> &values);

// Pixels, premultiplied RGBA, 8 bits a channel, rows from the top.
struct SvgPixels {
  int width{0}, height{0};
  std::vector<uint8_t> rgba;
};

// Runs `filter` over `source`, the element as drawn (SourceGraphic), whose pixels `toPixels` maps
// the element's user space to. Lengths and offsets scale with the transform; a subregion or the
// region is cut to its bounds in pixels.
SvgPixels runSvgFilter(const SvgFilter &filter, const SvgPixels &source, const SvgMatrix &toPixels);

// The drawing calls a backend makes for drawSvg, in a graphics state it saves and restores.
class SvgCanvas {
 public:
  virtual ~SvgCanvas() = default;
  virtual void save() = 0;
  virtual void restore() = 0;
  virtual void concat(const SvgMatrix &matrix) = 0;
  virtual void clip(const SvgPath &path, bool evenOdd) = 0;
  virtual void fill(const SvgPath &path, bool evenOdd, const SvgPaint &paint) = 0;
  virtual void stroke(const SvgPath &path, const SvgStroke &stroke, const SvgPaint &paint) = 0;
  // What is drawn until endLayer is composited as one, at `opacity`.
  virtual void beginLayer(double opacity) = 0;
  virtual void endLayer() = 0;
  // What is drawn until endMask is the mask (its luminance, or its alpha for an alpha mask); then
  // what is drawn until endMasked shows through it.
  virtual void beginMask(bool alpha) = 0;
  virtual void endMask() = 0;
  virtual void endMasked() = 0;
  // Clips to the outline `stroke` would draw of `path`.
  virtual void clipToStroke(const SvgPath &path, const SvgStroke &stroke) = 0;
  // Fills the clip with `tile` repeated, at `opacity`: `drawTile` draws one tile's content on a
  // canvas whose origin is the tile's, in the pattern's own space.
  virtual void pattern(const SvgPatternTile &tile, double opacity, const std::function<void(SvgCanvas &)> &drawTile) = 0;
  // What is drawn until endFilter is the source of `filter`, whose result is drawn in its place.
  virtual void beginFilter(const SvgFilter &filter) = 0;
  virtual void endFilter() = 0;
  virtual void image(const std::string &uri, const SvgRect &rect, const std::string &align, int meetOrSlice, double opacity) = 0;
  // Draws `text` with its baseline's start at (x, y) and answers its advance.
  virtual double text(
      const std::string &text,
      double x,
      double y,
      double fontSize,
      const std::string &fontFamily,
      const std::string &fontWeight,
      const SvgPaint *fill) = 0;
};

// Draws `document` into a viewport of `width` by `height`, its origin at the canvas's.
void drawSvg(const SvgDocument &document, double width, double height, SvgCanvas &canvas);

// The svgs of a surface's views, kept by the mounting manager as it mounts them: which svg each
// change belongs to, and each svg's document when it changed.
class SvgDrawings {
 public:
  // The element a view's props are, or nothing for a view that is not an svg element.
  // react-native-svg's glue (core/src/libraries/rnsvg.cpp) reads its props.
  using Reader = std::function<std::optional<SvgElement>(const facebook::react::Props &)>;
  explicit SvgDrawings(Reader reader = nullptr);

  // A view was made or its props changed, or `parent`'s children changed.
  void changed(const ViewTree &tree, Tag tag);
  void deleted(Tag tag);

  struct Drawing {
    Tag svg{-1};
    std::shared_ptr<const SvgDocument> document;
  };
  // The svgs whose documents changed since the last call.
  std::vector<Drawing> settle(const ViewTree &tree);

 private:
  std::optional<SvgElement> element(const ViewTree &tree, Tag tag) const;
  std::optional<SvgNode> node(const ViewTree &tree, Tag tag) const;

  Reader reader_;
  std::unordered_set<Tag> dirty_;
  std::unordered_map<Tag, std::shared_ptr<const SvgDocument>> drawn_;
};

} // namespace ngn
