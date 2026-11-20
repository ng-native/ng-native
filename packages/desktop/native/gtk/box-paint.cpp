#include "box-paint.h"

#include "cairo-canvas.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace ngn::gtk {

namespace {

bool rounded(const CornerRadii &r) {
  return r != CornerRadii{};
}

bool visible(const std::optional<uint32_t> &argb) {
  return argb && (*argb >> 24) != 0;
}

SvgRect paddingBox(const BoxDescription &box) {
  const auto &w = box.borderWidths;
  const auto &b = box.bounds;
  return {b.x + w.left, b.y + w.top, std::max(0.0, b.width - w.left - w.right), std::max(0.0, b.height - w.top - w.bottom)};
}

graphene_rect_t grapheneRect(const SvgRect &r) {
  graphene_rect_t out;
  graphene_rect_init(&out, static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.width), static_cast<float>(r.height));
  return out;
}

// The stops as GSK takes them: offsets clamped to 0 to 1 and never smaller than the one before.
std::vector<GskColorStop> colorStops(const SvgGradient &g) {
  std::vector<GskColorStop> stops;
  float last = 0;
  for (const auto &[offset, argb] : g.stops) {
    last = std::clamp(stops.empty() ? static_cast<float>(offset) : std::max(static_cast<float>(offset), last), 0.0f, 1.0f);
    stops.push_back({last, rgbaOf(argb)});
  }
  if (stops.size() == 1) {
    stops.push_back({1, stops[0].color});
  }
  return stops;
}

// The gradient filling `tile`, its own space's origin at the tile's top left (view-box.h). A linear
// gradient's transform is the identity; a radial one's places its centre and squashes its circle
// into the ellipse, which GSK takes as two radii.
void appendGradient(GtkSnapshot *snapshot, const SvgGradient &g, const SvgRect &tile) {
  auto stops = colorStops(g);
  if (stops.empty()) {
    return;
  }
  auto at = SvgMatrix::translate(tile.x, tile.y) * g.transform;
  graphene_rect_t bounds = grapheneRect(tile);
  if (g.radial) {
    auto [cx, cy] = at.apply(g.x1, g.y1);
    float rx = static_cast<float>(g.r * std::hypot(at.a, at.b)), ry = static_cast<float>(g.r * std::hypot(at.c, at.d));
    if (!(rx > 0) || !(ry > 0)) {
      return;
    }
    graphene_point_t centre;
    graphene_point_init(&centre, static_cast<float>(cx), static_cast<float>(cy));
    gtk_snapshot_append_radial_gradient(snapshot, &bounds, &centre, rx, ry, 0, 1, stops.data(), stops.size());
    return;
  }
  auto [x1, y1] = at.apply(g.x1, g.y1);
  auto [x2, y2] = at.apply(g.x2, g.y2);
  graphene_point_t start, end;
  graphene_point_init(&start, static_cast<float>(x1), static_cast<float>(y1));
  graphene_point_init(&end, static_cast<float>(x2), static_cast<float>(y2));
  if (graphene_point_equal(&start, &end)) {
    // No line to run along: CSS paints the last colour.
    GdkRGBA last = stops.back().color;
    gtk_snapshot_append_color(snapshot, &last, &bounds);
    return;
  }
  gtk_snapshot_append_linear_gradient(snapshot, &bounds, &start, &end, stops.data(), stops.size());
}

// The distinct starts of the tiles along one axis, and the step between them when it is the same
// throughout.
std::optional<double> step(std::vector<double> starts, double size) {
  std::sort(starts.begin(), starts.end());
  starts.erase(std::unique(starts.begin(), starts.end(), [](double a, double b) { return std::abs(a - b) < 1e-6; }), starts.end());
  if (starts.size() < 2) {
    return size;
  }
  double by = starts[1] - starts[0];
  for (size_t i = 2; i < starts.size(); ++i) {
    if (std::abs(starts[i] - starts[i - 1] - by) > 1e-3) {
      return std::nullopt;
    }
  }
  return by;
}

// One background image: its first tile drawn once and repeated by GSK over the others, the gap
// between `space` tiles included.
void appendBackgroundLayer(GtkSnapshot *snapshot, const BackgroundLayer &layer) {
  const auto &tiles = layer.tiles;
  if (tiles.empty()) {
    return;
  }
  const SvgRect &first = tiles[0];
  std::vector<double> xs, ys;
  double left = first.x, top = first.y, right = first.x + first.width, bottom = first.y + first.height;
  for (const auto &t : tiles) {
    xs.push_back(t.x);
    ys.push_back(t.y);
    left = std::min(left, t.x);
    top = std::min(top, t.y);
    right = std::max(right, t.x + t.width);
    bottom = std::max(bottom, t.y + t.height);
  }
  auto across = step(xs, first.width), down = step(ys, first.height);
  if (tiles.size() == 1 || !across || !down) {
    for (const auto &t : tiles) {
      appendGradient(snapshot, layer.gradient, t);
    }
    return;
  }
  graphene_rect_t all = grapheneRect({left, top, right - left, bottom - top});
  graphene_rect_t one = grapheneRect({left, top, *across, *down});
  gtk_snapshot_push_repeat(snapshot, &all, &one);
  appendGradient(snapshot, layer.gradient, {left, top, first.width, first.height});
  gtk_snapshot_pop(snapshot);
}

bool dashed(const BoxDescription &box) {
  return box.borderStyle == facebook::react::BorderStyle::Dashed || box.borderStyle == facebook::react::BorderStyle::Dotted;
}

} // namespace

GdkRGBA rgbaOf(uint32_t argb) {
  return {
      static_cast<float>((argb >> 16) & 0xff) / 255.0f,
      static_cast<float>((argb >> 8) & 0xff) / 255.0f,
      static_cast<float>(argb & 0xff) / 255.0f,
      static_cast<float>((argb >> 24) & 0xff) / 255.0f,
  };
}

GskRoundedRect gskRoundedRect(const SvgRect &rect, const CornerRadii &radii) {
  graphene_rect_t bounds;
  graphene_rect_init(&bounds, static_cast<float>(rect.x), static_cast<float>(rect.y), static_cast<float>(rect.width), static_cast<float>(rect.height));
  auto size = [](const CornerRadii::Corner &c) {
    graphene_size_t s;
    graphene_size_init(&s, static_cast<float>(std::max(0.0, c.x)), static_cast<float>(std::max(0.0, c.y)));
    return s;
  };
  graphene_size_t tl = size(radii.topLeft), tr = size(radii.topRight), br = size(radii.bottomRight), bl = size(radii.bottomLeft);
  GskRoundedRect out;
  gsk_rounded_rect_init(&out, &bounds, &tl, &tr, &br, &bl);
  gsk_rounded_rect_normalize(&out);
  return out;
}

void appendBox(GtkSnapshot *snapshot, const BoxDescription &box, const std::function<void()> &content) {
  if (box.bounds.width <= 0 || box.bounds.height <= 0) {
    return;
  }
  GskRoundedRect outline = gskRoundedRect(box.bounds, box.radii);

  // The outer shadows, the last listed at the bottom.
  for (auto it = box.shadows.rbegin(); it != box.shadows.rend(); ++it) {
    if (it->inset) {
      continue;
    }
    GdkRGBA color = rgbaOf(0xff000000);
    if (it->color) {
      auto c = facebook::react::colorComponentsFromColor(it->color);
      color = {c.red, c.green, c.blue, c.alpha};
    }
    gtk_snapshot_append_outset_shadow(
        snapshot, &outline, &color, static_cast<float>(it->offsetX), static_cast<float>(it->offsetY),
        static_cast<float>(it->spreadDistance), static_cast<float>(it->blurRadius));
  }

  if (visible(box.background) || !box.backgroundImages.empty()) {
    if (rounded(box.radii)) {
      gtk_snapshot_push_rounded_clip(snapshot, &outline);
    } else {
      gtk_snapshot_push_clip(snapshot, &outline.bounds);
    }
    if (visible(box.background)) {
      GdkRGBA color = rgbaOf(*box.background);
      gtk_snapshot_append_color(snapshot, &color, &outline.bounds);
    }
    for (const auto &layer : box.backgroundImages) {
      appendBackgroundLayer(snapshot, layer);
    }
    gtk_snapshot_pop(snapshot);
  }

  GskRoundedRect padding = gskRoundedRect(paddingBox(box), innerRadii(box.radii, box.borderWidths));
  for (auto it = box.shadows.rbegin(); it != box.shadows.rend(); ++it) {
    if (!it->inset) {
      continue;
    }
    GdkRGBA color = rgbaOf(0xff000000);
    if (it->color) {
      auto c = facebook::react::colorComponentsFromColor(it->color);
      color = {c.red, c.green, c.blue, c.alpha};
    }
    gtk_snapshot_append_inset_shadow(
        snapshot, &padding, &color, static_cast<float>(it->offsetX), static_cast<float>(it->offsetY),
        static_cast<float>(it->spreadDistance), static_cast<float>(it->blurRadius));
  }

  if (content) {
    content();
  }

  const auto &w = box.borderWidths;
  if (dashed(box) && (w.top > 0 || w.right > 0 || w.bottom > 0 || w.left > 0)) {
    // GSK strokes paths only from GTK 4.14, and the host builds against 4.12: cairo strokes the
    // dashes the core lays out, as on macOS.
    graphene_rect_t bounds = grapheneRect(box.bounds);
    cairo_t *cr = gtk_snapshot_append_cairo(snapshot, &bounds);
    auto canvas = makeCairoCanvas(cr, box.bounds.width, box.bounds.height, 1);
    // React Native's default border colour is black, as in the solid case below.
    BoxDescription painted{
        .bounds = box.bounds, .radii = box.radii, .borderWidths = box.borderWidths, .borderColors = box.borderColors, .borderStyle = box.borderStyle};
    for (auto *side : {&painted.borderColors.top, &painted.borderColors.right, &painted.borderColors.bottom, &painted.borderColors.left}) {
      if (!*side) {
        *side = 0xff000000;
      }
    }
    drawBorder(painted, *canvas);
    canvas.reset();
    cairo_destroy(cr);
  } else if (w.top > 0 || w.right > 0 || w.bottom > 0 || w.left > 0) {
    // React Native's default border colour is black.
    const auto &c = box.borderColors;
    float widths[4] = {static_cast<float>(w.top), static_cast<float>(w.right), static_cast<float>(w.bottom), static_cast<float>(w.left)};
    GdkRGBA colors[4] = {
        rgbaOf(c.top.value_or(0xff000000)),
        rgbaOf(c.right.value_or(0xff000000)),
        rgbaOf(c.bottom.value_or(0xff000000)),
        rgbaOf(c.left.value_or(0xff000000)),
    };
    gtk_snapshot_append_border(snapshot, &outline, widths, colors);
  }
}

bool pushOverflowClip(GtkSnapshot *snapshot, const BoxDescription &box) {
  if (!box.clips) {
    return false;
  }
  GskRoundedRect outline = gskRoundedRect(box.bounds, box.radii);
  if (rounded(box.radii)) {
    gtk_snapshot_push_rounded_clip(snapshot, &outline);
  } else {
    gtk_snapshot_push_clip(snapshot, &outline.bounds);
  }
  return true;
}

} // namespace ngn::gtk
