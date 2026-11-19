#include "cairo-canvas.h"

#include "image-view.h"
#include "pango-text.h"

#include <react/renderer/attributedstring/TextAttributes.h>

#include <pango/pangocairo.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace ngn::gtk {

namespace {

void setColor(cairo_t *cr, uint32_t argb, double opacity) {
  cairo_set_source_rgba(
      cr, ((argb >> 16) & 0xff) / 255.0, ((argb >> 8) & 0xff) / 255.0, (argb & 0xff) / 255.0, ((argb >> 24) & 0xff) / 255.0 * opacity);
}

cairo_matrix_t cairoMatrix(const SvgMatrix &m) {
  cairo_matrix_t out;
  cairo_matrix_init(&out, m.a, m.b, m.c, m.d, m.e, m.f);
  return out;
}

void addPath(cairo_t *cr, const SvgPath &path) {
  cairo_new_path(cr);
  for (const auto &s : path.segments) {
    switch (s.op) {
      case SvgPath::Op::Move:
        cairo_move_to(cr, s.points[0], s.points[1]);
        break;
      case SvgPath::Op::Line:
        cairo_line_to(cr, s.points[0], s.points[1]);
        break;
      case SvgPath::Op::Cubic:
        cairo_curve_to(cr, s.points[0], s.points[1], s.points[2], s.points[3], s.points[4], s.points[5]);
        break;
      case SvgPath::Op::Close:
        cairo_close_path(cr);
        break;
    }
  }
}

void applyStroke(cairo_t *cr, const SvgStroke &stroke) {
  cairo_set_line_width(cr, stroke.width);
  cairo_set_line_cap(cr, stroke.cap == 1 ? CAIRO_LINE_CAP_ROUND : stroke.cap == 2 ? CAIRO_LINE_CAP_SQUARE : CAIRO_LINE_CAP_BUTT);
  cairo_set_line_join(cr, stroke.join == 1 ? CAIRO_LINE_JOIN_ROUND : stroke.join == 2 ? CAIRO_LINE_JOIN_BEVEL : CAIRO_LINE_JOIN_MITER);
  cairo_set_miter_limit(cr, stroke.miterLimit);
  cairo_set_dash(cr, stroke.dashes.empty() ? nullptr : stroke.dashes.data(), static_cast<int>(stroke.dashes.size()), stroke.dashOffset);
}

// A gradient as a cairo pattern over user space, at `opacity`: its stops' offsets only grow, as
// SVG clamps a smaller one to the one before, and it pads past its ends. Null for a gradient whose
// transform cannot be inverted, which paints nothing.
cairo_pattern_t *gradientPattern(const SvgGradient &g, double opacity) {
  cairo_matrix_t toGradient = cairoMatrix(g.transform);
  if (cairo_matrix_invert(&toGradient) != CAIRO_STATUS_SUCCESS) {
    return nullptr;
  }
  cairo_pattern_t *pattern = g.radial ? cairo_pattern_create_radial(g.x2, g.y2, 0, g.x1, g.y1, g.r)
                                      : cairo_pattern_create_linear(g.x1, g.y1, g.x2, g.y2);
  double last = 0;
  bool first = true;
  for (const auto &[offset, argb] : g.stops) {
    last = std::clamp(first ? offset : std::max(offset, last), 0.0, 1.0);
    first = false;
    cairo_pattern_add_color_stop_rgba(
        pattern, last, ((argb >> 16) & 0xff) / 255.0, ((argb >> 8) & 0xff) / 255.0, (argb & 0xff) / 255.0,
        ((argb >> 24) & 0xff) / 255.0 * opacity);
  }
  cairo_pattern_set_extend(pattern, CAIRO_EXTEND_PAD);
  cairo_pattern_set_matrix(pattern, &toGradient);
  return pattern;
}

// The current path filled or stroked (`fill`) in `paint`: a colour, or a gradient.
void paintPath(cairo_t *cr, const SvgPaint &paint, bool fill) {
  if (paint.gradient) {
    cairo_pattern_t *pattern = gradientPattern(*paint.gradient, paint.opacity);
    if (!pattern) {
      cairo_new_path(cr);
      return;
    }
    cairo_set_source(cr, pattern);
    cairo_pattern_destroy(pattern);
  } else {
    setColor(cr, paint.argb, paint.opacity);
  }
  fill ? cairo_fill(cr) : cairo_stroke(cr);
}

// The first stop of a gradient, which text takes, as on macOS.
uint32_t solidOf(const SvgPaint &paint) {
  return paint.gradient && !paint.gradient->stops.empty() ? paint.gradient->stops[0].second : paint.argb;
}

PangoContext *measureContext() {
  thread_local PangoContext *context = [] {
    PangoContext *c = pango_font_map_create_context(pango_cairo_font_map_get_default());
    cairo_font_options_t *options = cairo_font_options_create();
    cairo_font_options_set_hint_metrics(options, CAIRO_HINT_METRICS_OFF);
    pango_cairo_context_set_font_options(c, options);
    cairo_font_options_destroy(options);
    return c;
  }();
  return context;
}

// `text` laid out on one line in the font, as React Native's text would name it, a line break in it
// a space as SVG's white space has it. The caller frees it.
PangoLayout *lineOf(std::string text, double fontSize, const std::string &family, const std::string &weight) {
  std::replace_if(text.begin(), text.end(), [](char c) { return c == '\n' || c == '\r'; }, ' ');
  facebook::react::TextAttributes attributes;
  attributes.fontSize = static_cast<facebook::react::Float>(fontSize);
  attributes.fontFamily = family;
  int w = weight == "bold" ? 700 : std::atoi(weight.c_str());
  attributes.fontWeight = static_cast<facebook::react::FontWeight>(w > 0 ? w : 400);
  PangoLayout *layout = pango_layout_new(measureContext());
  PangoFontDescription *font = fontOf(attributes);
  pango_layout_set_font_description(layout, font);
  pango_font_description_free(font);
  pango_layout_set_text(layout, text.c_str(), static_cast<int>(text.size()));
  return layout;
}

// A cluster's glyphs as its run shaped them: the run's font and the cluster's glyphs, placed from
// the cluster's start.
struct ShapedGlyphs {
  PangoFont *font{nullptr};
  PangoGlyphString *glyphs{nullptr};
  ShapedGlyphs() = default;
  ShapedGlyphs(const ShapedGlyphs &) = delete;
  ShapedGlyphs &operator=(const ShapedGlyphs &) = delete;
  ~ShapedGlyphs() {
    if (font) {
      g_object_unref(font);
    }
    if (glyphs) {
      pango_glyph_string_free(glyphs);
    }
  }
};

// Images an svg's <image> draws, by uri, loaded once for every svg, and the canvases waiting for one.
struct SvgImages {
  std::map<std::string, cairo_surface_t *> loaded;
  std::map<std::string, std::vector<std::function<void()>>> waiting;
  // The uris that failed to load or to become a cairo surface: not asked for again on each draw.
  std::set<std::string> failed;
  // The loaded ones in the order they loaded.
  std::vector<std::pair<std::string, cairo_surface_t *>> order;
  // How many svg views hold each uri held (SvgImageHold): a held image is not let go.
  std::map<std::string, int> holders;
};

SvgImages &svgImages() {
  static SvgImages images;
  return images;
}

// Null when cairo cannot hold the picture: larger than an image surface can be, or out of memory.
cairo_surface_t *surfaceOf(GdkTexture *texture) {
  int width = gdk_texture_get_width(texture), height = gdk_texture_get_height(texture);
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
  if (cairo_surface_status(surface) != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(surface);
    return nullptr;
  }
  cairo_surface_flush(surface);
  gdk_texture_download(texture, cairo_image_surface_get_data(surface), static_cast<gsize>(cairo_image_surface_get_stride(surface)));
  cairo_surface_mark_dirty(surface);
  return surface;
}

class CairoCanvas final : public SvgCanvas {
 public:
  CairoCanvas(cairo_t *cr, double width, double height, double scale, std::function<void()> imageLoaded, SvgImageHold *hold)
      : cr_(cr), width_(width), height_(height), scale_(scale), imageLoaded_(std::move(imageLoaded)), hold_(hold) {
    cairo_get_matrix(cr_, &base_);
  }

  void save() override {
    cairo_save(cr_);
    saved_.push_back({matrix_, strokeClip_});
  }

  void restore() override {
    cairo_restore(cr_);
    if (!saved_.empty()) {
      matrix_ = saved_.back().matrix;
      strokeClip_ = saved_.back().strokeClip;
      saved_.pop_back();
    }
  }

  // A transform that cannot be inverted, as scale(0), draws nothing until the restore: given to
  // cairo it would put the context in an error state that no restore clears.
  void concat(const SvgMatrix &m) override {
    cairo_matrix_t transform = cairoMatrix(m), inverse = transform;
    if (cairo_matrix_invert(&inverse) == CAIRO_STATUS_SUCCESS) {
      cairo_transform(cr_, &transform);
    } else {
      cairo_new_path(cr_);
      cairo_rectangle(cr_, 0, 0, 0, 0);
      cairo_clip(cr_);
    }
    matrix_ = matrix_ * m;
  }

  void clip(const SvgPath &path, bool evenOdd) override {
    addPath(cr_, path);
    cairo_set_fill_rule(cr_, evenOdd ? CAIRO_FILL_RULE_EVEN_ODD : CAIRO_FILL_RULE_WINDING);
    cairo_clip(cr_);
  }

  void fill(const SvgPath &path, bool evenOdd, const SvgPaint &paint) override {
    addPath(cr_, path);
    cairo_set_fill_rule(cr_, evenOdd ? CAIRO_FILL_RULE_EVEN_ODD : CAIRO_FILL_RULE_WINDING);
    paintPath(cr_, paint, true);
  }

  void stroke(const SvgPath &path, const SvgStroke &stroke, const SvgPaint &paint) override {
    cairo_save(cr_);
    applyStroke(cr_, stroke);
    addPath(cr_, path);
    paintPath(cr_, paint, false);
    cairo_restore(cr_);
  }

  void beginLayer(double opacity) override {
    cairo_save(cr_);
    cairo_push_group(cr_);
    layers_.push_back(opacity);
  }

  void endLayer() override {
    if (layers_.empty()) {
      return;
    }
    cairo_pop_group_to_source(cr_);
    cairo_paint_with_alpha(cr_, layers_.back());
    layers_.pop_back();
    cairo_restore(cr_);
  }

  // The mask is drawn in a bitmap of the view's pixels: a luminance mask in colour, turned into
  // its luminance times its alpha, as SVG masks by; an alpha mask's alpha as it is.
  void beginMask(bool alpha) override {
    cairo_surface_t *surface = viewSurface();
    cairo_t *mask = drawingInto(surface);
    masks_.push_back({.parent = cr_, .mask = mask, .surface = surface, .saved = saved_, .alpha = alpha});
    cr_ = mask;
  }

  void endMask() override {
    if (masks_.empty()) {
      return;
    }
    Mask &frame = masks_.back();
    cr_ = frame.parent;
    saved_ = frame.saved;
    cairo_destroy(frame.mask);
    frame.mask = nullptr;
    if (!frame.alpha) {
      toLuminance(frame.surface);
    }
    // What follows is drawn in a group, which endMasked draws through the mask.
    cairo_save(cr_);
    cairo_push_group(cr_);
  }

  void endMasked() override {
    if (masks_.empty()) {
      return;
    }
    Mask frame = masks_.back();
    masks_.pop_back();
    cairo_pop_group_to_source(cr_);
    cairo_set_matrix(cr_, &base_);
    cairo_mask_surface(cr_, frame.surface, 0, 0);
    cairo_surface_destroy(frame.surface);
    cairo_restore(cr_);
  }

  // A pattern stroke: the next pattern paints along this stroke, not over the clip.
  void clipToStroke(const SvgPath &path, const SvgStroke &stroke) override {
    strokeClip_ = std::make_pair(path, stroke);
  }

  // The tile is drawn once into a bitmap at the pixels it covers, which repeats over the clip, or
  // along the stroke clipToStroke set.
  void pattern(const SvgPatternTile &tile, double opacity, const std::function<void(SvgCanvas &)> &drawTile) override {
    SvgMatrix toView = matrix_ * tile.transform;
    double density = scale_ * std::sqrt(std::abs(toView.a * toView.d - toView.b * toView.c));
    if (!(density > 0) || tile.tile.width <= 0 || tile.tile.height <= 0) {
      return;
    }
    // At most 2048 pixels a side: a larger tile is drawn coarser.
    density = std::min({density, 2048 / tile.tile.width, 2048 / tile.tile.height});
    int width = std::max(1, static_cast<int>(std::ceil(tile.tile.width * density)));
    int height = std::max(1, static_cast<int>(std::ceil(tile.tile.height * density)));
    cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    cairo_surface_set_device_scale(surface, width / tile.tile.width, height / tile.tile.height);
    {
      cairo_t *cr = cairo_create(surface);
      CairoCanvas inner(cr, tile.tile.width, tile.tile.height, density, imageLoaded_, hold_);
      drawTile(inner);
      cairo_destroy(cr);
    }
    // The tile's place is in the pattern's own matrix, from user space to the tile's: a source takes
    // the user space current where it is set, which is the outer one below.
    cairo_pattern_t *repeat = cairo_pattern_create_for_surface(surface);
    cairo_matrix_t toTile = cairoMatrix(tile.transform);
    cairo_matrix_translate(&toTile, tile.tile.x, tile.tile.y);
    if (cairo_matrix_invert(&toTile) != CAIRO_STATUS_SUCCESS) {
      cairo_pattern_destroy(repeat);
      cairo_surface_destroy(surface);
      return;
    }
    cairo_pattern_set_matrix(repeat, &toTile);
    cairo_pattern_set_extend(repeat, CAIRO_EXTEND_REPEAT);
    cairo_save(cr_);
    if (strokeClip_) {
      // Through a group, so the opacity applies once where the stroke crosses itself.
      cairo_push_group(cr_);
      cairo_set_source(cr_, repeat);
      applyStroke(cr_, strokeClip_->second);
      addPath(cr_, strokeClip_->first);
      cairo_stroke(cr_);
      cairo_pop_group_to_source(cr_);
    } else {
      cairo_set_source(cr_, repeat);
    }
    cairo_paint_with_alpha(cr_, opacity);
    cairo_restore(cr_);
    cairo_pattern_destroy(repeat);
    cairo_surface_destroy(surface);
  }

  // The source is drawn in a bitmap of the filter region's pixels, which can reach past the view's,
  // so an offset brings in what is drawn outside the view; the filter's result is drawn back in its
  // place.
  void beginFilter(const SvgFilter &filter) override {
    auto [x, y, width, height] = regionPixels(filter.region);
    cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    cairo_surface_set_device_scale(surface, scale_, scale_);
    cairo_surface_set_device_offset(surface, -x, -y);
    cairo_t *cr = drawingInto(surface);
    filters_.push_back({.parent = cr_, .cr = cr, .surface = surface, .saved = saved_, .filter = filter, .x = x, .y = y});
    cr_ = cr;
  }

  void endFilter() override {
    if (filters_.empty()) {
      return;
    }
    Filter frame = std::move(filters_.back());
    filters_.pop_back();
    cr_ = frame.parent;
    saved_ = frame.saved;
    cairo_destroy(frame.cr);
    cairo_surface_flush(frame.surface);
    int width = cairo_image_surface_get_width(frame.surface), height = cairo_image_surface_get_height(frame.surface);
    int stride = cairo_image_surface_get_stride(frame.surface);
    unsigned char *data = cairo_image_surface_get_data(frame.surface);
    // cairo's pixels are premultiplied ARGB words; the filter's are premultiplied RGBA bytes.
    SvgPixels source{.width = width, .height = height};
    source.rgba.resize(static_cast<size_t>(width) * height * 4);
    for (int y = 0; y < height; ++y) {
      const auto *row = reinterpret_cast<const uint32_t *>(data + static_cast<size_t>(y) * stride);
      for (int x = 0; x < width; ++x) {
        uint8_t *p = &source.rgba[(static_cast<size_t>(y) * width + x) * 4];
        p[0] = (row[x] >> 16) & 0xff;
        p[1] = (row[x] >> 8) & 0xff;
        p[2] = row[x] & 0xff;
        p[3] = row[x] >> 24;
      }
    }
    auto result = runSvgFilter(frame.filter, source, SvgMatrix::translate(-frame.x, -frame.y) * SvgMatrix::scale(scale_, scale_) * matrix_);
    for (int y = 0; y < height && y < result.height; ++y) {
      auto *row = reinterpret_cast<uint32_t *>(data + static_cast<size_t>(y) * stride);
      for (int x = 0; x < width && x < result.width; ++x) {
        const uint8_t *p = &result.rgba[(static_cast<size_t>(y) * result.width + x) * 4];
        row[x] = (uint32_t(p[3]) << 24) | (uint32_t(p[0]) << 16) | (uint32_t(p[1]) << 8) | p[2];
      }
    }
    cairo_surface_mark_dirty(frame.surface);
    cairo_save(cr_);
    cairo_set_matrix(cr_, &base_);
    cairo_set_source_surface(cr_, frame.surface, 0, 0);
    cairo_paint(cr_);
    cairo_restore(cr_);
    cairo_surface_destroy(frame.surface);
  }

  void image(const std::string &uri, const SvgRect &rect, const std::string &align, int meetOrSlice, double opacity) override {
    auto &images = svgImages();
    if (hold_) {
      hold_->use(uri);
    }
    auto found = images.loaded.find(uri);
    if (found == images.loaded.end()) {
      if (!images.failed.contains(uri)) {
        load(uri);
      }
      return;
    }
    cairo_surface_t *surface = found->second;
    double width = cairo_image_surface_get_width(surface), height = cairo_image_surface_get_height(surface);
    if (width <= 0 || height <= 0) {
      return;
    }
    auto fit = svgViewBoxTransform({0, 0, width, height}, align, meetOrSlice, rect.width, rect.height);
    cairo_save(cr_);
    cairo_rectangle(cr_, rect.x, rect.y, rect.width, rect.height);
    cairo_clip(cr_);
    cairo_translate(cr_, rect.x, rect.y);
    cairo_matrix_t transform = cairoMatrix(fit);
    cairo_transform(cr_, &transform);
    cairo_set_source_surface(cr_, surface, 0, 0);
    cairo_paint_with_alpha(cr_, opacity);
    cairo_restore(cr_);
  }

  double measureText(const std::string &text, double fontSize, const std::string &fontFamily, const std::string &fontWeight) override {
    PangoLayout *layout = lineOf(text, fontSize, fontFamily, fontWeight);
    PangoRectangle logical;
    pango_layout_get_extents(layout, nullptr, &logical);
    g_object_unref(layout);
    return static_cast<double>(logical.width) / PANGO_SCALE;
  }

  // Pango's clusters of `text` on one shaped line, each with its run's font and its own glyphs.
  std::vector<SvgGlyphCluster> glyphClusters(
      const std::string &text, double fontSize, const std::string &fontFamily, const std::string &fontWeight) override {
    std::vector<SvgGlyphCluster> out;
    std::vector<int> starts;
    PangoLayout *layout = lineOf(text, fontSize, fontFamily, fontWeight);
    PangoLayoutLine *line = pango_layout_get_line_readonly(layout, 0);
    double runX = 0;
    for (GSList *item = line ? line->runs : nullptr; item; item = item->next) {
      auto *run = static_cast<PangoGlyphItem *>(item->data);
      // Where each glyph starts in the run.
      std::vector<int> glyphX(static_cast<size_t>(run->glyphs->num_glyphs) + 1, 0);
      for (int g = 0; g < run->glyphs->num_glyphs; ++g) {
        glyphX[g + 1] = glyphX[g] + run->glyphs->glyphs[g].geometry.width;
      }
      PangoGlyphItemIter iter;
      for (bool more = pango_glyph_item_iter_init_start(&iter, run, pango_layout_get_text(layout)); more; more = pango_glyph_item_iter_next_cluster(&iter)) {
        auto shaped = std::make_shared<ShapedGlyphs>();
        shaped->font = PANGO_FONT(g_object_ref(run->item->analysis.font));
        int first = std::min(iter.start_glyph, iter.end_glyph), last = std::max(iter.start_glyph, iter.end_glyph);
        if (iter.start_glyph > iter.end_glyph) {
          // A right-to-left run steps from its last glyph back: the cluster is the ones after end_glyph.
          first = iter.end_glyph + 1;
          last = iter.start_glyph + 1;
        }
        shaped->glyphs = pango_glyph_string_new();
        pango_glyph_string_set_size(shaped->glyphs, last - first);
        for (int g = first; g < last; ++g) {
          shaped->glyphs->glyphs[g - first] = run->glyphs->glyphs[g];
          shaped->glyphs->log_clusters[g - first] = 0;
        }
        int start = glyphX[first], advance = glyphX[last] - glyphX[first];
        starts.push_back(iter.start_index);
        out.push_back({
            .text = text.substr(static_cast<size_t>(iter.start_index), static_cast<size_t>(iter.end_index - iter.start_index)),
            .x = runX + static_cast<double>(start) / PANGO_SCALE,
            .advance = static_cast<double>(advance) / PANGO_SCALE,
            .glyphs = shaped,
        });
      }
      runX += static_cast<double>(pango_glyph_string_get_width(run->glyphs)) / PANGO_SCALE;
    }
    g_object_unref(layout);
    // In the order of the text: runs come in visual order.
    std::vector<size_t> order(out.size());
    for (size_t i = 0; i < order.size(); ++i) {
      order[i] = i;
    }
    std::stable_sort(order.begin(), order.end(), [&starts](size_t a, size_t b) { return starts[a] < starts[b]; });
    std::vector<SvgGlyphCluster> sorted;
    for (size_t i : order) {
      sorted.push_back(std::move(out[i]));
    }
    return sorted;
  }

  void glyphCluster(const SvgGlyphCluster &cluster, double x, double y, const SvgPaint &fill) override {
    auto shaped = std::static_pointer_cast<const ShapedGlyphs>(cluster.glyphs);
    if (!shaped || !shaped->glyphs) {
      return;
    }
    cairo_save(cr_);
    setColor(cr_, solidOf(fill), fill.opacity);
    cairo_move_to(cr_, x, y);
    pango_cairo_show_glyph_string(cr_, shaped->font, shaped->glyphs);
    cairo_restore(cr_);
  }

  void text(
      const std::string &text,
      double x,
      double y,
      double fontSize,
      const std::string &fontFamily,
      const std::string &fontWeight,
      const SvgPaint &fill) override {
    PangoLayout *layout = lineOf(text, fontSize, fontFamily, fontWeight);
    double baseline = static_cast<double>(pango_layout_get_baseline(layout)) / PANGO_SCALE;
    cairo_save(cr_);
    setColor(cr_, solidOf(fill), fill.opacity);
    cairo_move_to(cr_, x, y - baseline);
    pango_cairo_show_layout(cr_, layout);
    cairo_restore(cr_);
    g_object_unref(layout);
  }

  void views(Tag) override {}

 private:
  struct Saved {
    SvgMatrix matrix;
    std::optional<std::pair<SvgPath, SvgStroke>> strokeClip;
  };
  struct Mask {
    cairo_t *parent;
    cairo_t *mask;
    cairo_surface_t *surface;
    std::vector<Saved> saved;
    bool alpha{false};
  };
  struct Filter {
    cairo_t *parent;
    cairo_t *cr;
    cairo_surface_t *surface;
    std::vector<Saved> saved;
    SvgFilter filter;
    // Where the bitmap's corner is in the view's pixels.
    int x{0}, y{0};
  };

  // The filter region's bounds in the view's pixels: x, y, width and height. A region of more pixels
  // than the view and than 2048 by 2048 is cut to the view's: the filter's work grows with them.
  std::array<int, 4> regionPixels(const SvgRect &region) const {
    SvgMatrix toPixels = SvgMatrix::scale(scale_, scale_) * matrix_;
    double minX = INFINITY, minY = INFINITY, maxX = -INFINITY, maxY = -INFINITY;
    for (auto [rx, ry] : {std::pair{region.x, region.y}, {region.x + region.width, region.y}, {region.x, region.y + region.height},
                          {region.x + region.width, region.y + region.height}}) {
      auto [px, py] = toPixels.apply(rx, ry);
      minX = std::min(minX, px);
      minY = std::min(minY, py);
      maxX = std::max(maxX, px);
      maxY = std::max(maxY, py);
    }
    double viewWidth = std::ceil(width_ * scale_), viewHeight = std::ceil(height_ * scale_);
    minX = std::floor(minX), minY = std::floor(minY), maxX = std::ceil(maxX), maxY = std::ceil(maxY);
    if (!((maxX - minX) * (maxY - minY) <= std::max(viewWidth * viewHeight, 2048.0 * 2048.0) &&std::abs(minX) < 1e7 && std::abs(minY) < 1e7)) {
      minX = std::max(minX, 0.0), minY = std::max(minY, 0.0), maxX = std::min(maxX, viewWidth), maxY = std::min(maxY, viewHeight);
    }
    if (!(maxX > minX && maxY > minY)) {
      return {0, 0, 1, 1};
    }
    return {static_cast<int>(minX), static_cast<int>(minY), static_cast<int>(maxX - minX), static_cast<int>(maxY - minY)};
  }

  // A transparent bitmap of the view's pixels, in the view's points.
  cairo_surface_t *viewSurface() const {
    int width = std::max(1, static_cast<int>(std::ceil(width_ * scale_)));
    int height = std::max(1, static_cast<int>(std::ceil(height_ * scale_)));
    cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
    cairo_surface_set_device_scale(surface, scale_, scale_);
    return surface;
  }

  // Drawing on `surface` where the drawing is now: the view's points, then the user transform.
  cairo_t *drawingInto(cairo_surface_t *surface) const {
    cairo_t *cr = cairo_create(surface);
    cairo_matrix_t transform = cairoMatrix(matrix_);
    cairo_transform(cr, &transform);
    return cr;
  }

  // Each pixel's alpha becomes its luminance times its alpha (the premultiplied colour's luminance).
  static void toLuminance(cairo_surface_t *surface) {
    cairo_surface_flush(surface);
    int width = cairo_image_surface_get_width(surface), height = cairo_image_surface_get_height(surface);
    int stride = cairo_image_surface_get_stride(surface);
    unsigned char *data = cairo_image_surface_get_data(surface);
    for (int y = 0; y < height; ++y) {
      auto *row = reinterpret_cast<uint32_t *>(data + static_cast<size_t>(y) * stride);
      for (int x = 0; x < width; ++x) {
        double r = (row[x] >> 16) & 0xff, g = (row[x] >> 8) & 0xff, b = row[x] & 0xff;
        auto luminance = static_cast<uint32_t>(std::lround(std::clamp(0.2125 * r + 0.7154 * g + 0.0721 * b, 0.0, 255.0)));
        row[x] = luminance << 24;
      }
    }
    cairo_surface_mark_dirty(surface);
  }

  // Every canvas that asks for a uri while it loads is told when it has loaded or failed to.
  void load(const std::string &uri) {
    auto &images = svgImages();
    bool started = images.waiting.contains(uri);
    auto &waiters = images.waiting[uri];
    if (imageLoaded_) {
      waiters.push_back(imageLoaded_);
    }
    if (started) {
      return;
    }
    facebook::react::ImageSource source;
    source.uri = uri;
    readImage(source, [uri](GdkTexture *texture, const std::string &) {
      auto &images = svgImages();
      auto waiters = std::move(images.waiting[uri]);
      images.waiting.erase(uri);
      cairo_surface_t *surface = texture ? surfaceOf(texture) : nullptr;
      if (texture) {
        g_object_unref(texture);
      }
      if (!surface) {
        images.failed.insert(uri);
      } else {
        // At most 64 kept, the first loaded going first, as macOS lets its image cache go; one an
        // svg view holds stays, past 64 when need be.
        while (images.loaded.size() >= 64) {
          auto unheld = std::find_if(images.order.begin(), images.order.end(), [&images](const auto &entry) {
            return !images.holders.contains(entry.first);
          });
          if (unheld == images.order.end()) {
            break;
          }
          cairo_surface_destroy(unheld->second);
          images.loaded.erase(unheld->first);
          images.order.erase(unheld);
        }
        images.loaded[uri] = surface;
        images.order.emplace_back(uri, surface);
      }
      for (auto &waiter : waiters) {
        waiter();
      }
    });
  }

  cairo_t *cr_;
  double width_, height_, scale_;
  std::function<void()> imageLoaded_;
  SvgImageHold *hold_;
  cairo_matrix_t base_;
  SvgMatrix matrix_;
  std::optional<std::pair<SvgPath, SvgStroke>> strokeClip_;
  std::vector<Saved> saved_;
  std::vector<double> layers_;
  std::vector<Mask> masks_;
  std::vector<Filter> filters_;
};

} // namespace

SvgImageHold::~SvgImageHold() {
  next_.clear();
  drawn();
}

void SvgImageHold::use(const std::string &uri) {
  next_.insert(uri);
}

void SvgImageHold::drawn() {
  auto &holders = svgImages().holders;
  for (const auto &uri : next_) {
    ++holders[uri];
  }
  for (const auto &uri : held_) {
    if (auto found = holders.find(uri); found != holders.end() && --found->second <= 0) {
      holders.erase(found);
    }
  }
  held_ = std::move(next_);
  next_.clear();
}

std::unique_ptr<SvgCanvas> makeCairoCanvas(
    cairo_t *cr, double width, double height, double scale, std::function<void()> imageLoaded, SvgImageHold *hold) {
  return std::make_unique<CairoCanvas>(cr, width, height, scale, std::move(imageLoaded), hold);
}

} // namespace ngn::gtk
