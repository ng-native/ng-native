#include "box-paint.h"

#include <algorithm>

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

  if (visible(box.background)) {
    GdkRGBA color = rgbaOf(*box.background);
    if (rounded(box.radii)) {
      gtk_snapshot_push_rounded_clip(snapshot, &outline);
      gtk_snapshot_append_color(snapshot, &color, &outline.bounds);
      gtk_snapshot_pop(snapshot);
    } else {
      gtk_snapshot_append_color(snapshot, &color, &outline.bounds);
    }
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
  if (w.top > 0 || w.right > 0 || w.bottom > 0 || w.left > 0) {
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
