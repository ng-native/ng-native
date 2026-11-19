#include "pango-text.h"

#include "fonts.h"

#include "ngn/surface-metrics.h"

#include <gtk/gtk.h>
#include <pango/pangofc-fontmap.h>

#include <react/renderer/graphics/Color.h>

#include <algorithm>
#include <cmath>
#include <optional>
#include <string>

using namespace facebook::react;

namespace ngn::gtk {

namespace {

float scaleOf(const TextAttributes &a) {
  float multiplier = 1;
  if (a.allowFontScaling.value_or(true) && !std::isnan(a.fontSizeMultiplier)) {
    multiplier = a.fontSizeMultiplier;
    if (!std::isnan(a.maxFontSizeMultiplier) && a.maxFontSizeMultiplier >= 1) {
      multiplier = std::min<float>(multiplier, a.maxFontSizeMultiplier);
    }
  }
  return multiplier;
}

// One context per thread, since a Pango cairo font map is per thread.
PangoContext *threadContext() {
  thread_local PangoContext *context = [] {
    PangoContext *c = pango_font_map_create_context(pango_cairo_font_map_get_default());
    cairo_font_options_t *options = cairo_font_options_create();
    cairo_font_options_set_hint_metrics(options, CAIRO_HINT_METRICS_OFF);
    cairo_font_options_set_hint_style(options, CAIRO_HINT_STYLE_NONE);
    pango_cairo_context_set_font_options(c, options);
    cairo_font_options_destroy(options);
    pango_context_set_round_glyph_positions(c, FALSE);
    return c;
  }();
  return context;
}

void addAttribute(PangoAttrList *list, PangoAttribute *attribute, guint start, guint end) {
  attribute->start_index = start;
  attribute->end_index = end;
  pango_attr_list_insert(list, attribute);
}

guint16 channel(float value) {
  return static_cast<guint16>(std::lround(std::clamp(value, 0.0f, 1.0f) * 65535));
}

} // namespace

TextLayout::TextLayout(TextLayout &&other) noexcept : layout(other.layout), top(other.top), size(other.size) {
  other.layout = nullptr;
}

TextLayout &TextLayout::operator=(TextLayout &&other) noexcept {
  if (this != &other) {
    if (layout) {
      g_object_unref(layout);
    }
    layout = other.layout;
    top = other.top;
    size = other.size;
    other.layout = nullptr;
  }
  return *this;
}

TextLayout::~TextLayout() {
  if (layout) {
    g_object_unref(layout);
  }
}

bool pangoHasLineHeight() {
#if PANGO_VERSION_CHECK(1, 50, 0)
  return pango_version() >= PANGO_VERSION_ENCODE(1, 50, 0);
#else
  return false;
#endif
}

// The calling thread's font map looks again at fontconfig once fonts were added since it last did:
// a Pango cairo font map is per thread, and caches what fontconfig had.
void refreshFontMap() {
  thread_local uint64_t seen = 0;
  uint64_t added = fontsAdded();
  if (added == seen) {
    return;
  }
  seen = added;
  PangoFontMap *map = pango_cairo_font_map_get_default();
  if (PANGO_IS_FC_FONT_MAP(map)) {
    pango_fc_font_map_config_changed(PANGO_FC_FONT_MAP(map));
  }
}

PangoFontDescription *fontOf(const TextAttributes &a) {
  refreshFontMap();
  PangoFontDescription *font = pango_font_description_new();
  const std::string &family = a.fontFamily;
  if (family.empty() || family == "System" || family == "system-ui" || family == "sans-serif") {
    pango_font_description_set_family(font, "sans-serif");
  } else if (family == "monospace" || family == "Menlo" || family == "ui-monospace") {
    pango_font_description_set_family(font, "monospace");
  } else {
    // A name a font was loaded under stands for that font's family, as on macOS.
    auto library = fontLibrary();
    auto loaded = library ? library->fontOf(family) : std::nullopt;
    pango_font_description_set_family(font, (loaded ? loaded->family : family).c_str());
  }
  double size = (std::isnan(a.fontSize) ? 14 : a.fontSize) * scaleOf(a);
  // Absolute: a React Native font size is in points, which are the surface's logical pixels.
  pango_font_description_set_absolute_size(font, size * PANGO_SCALE);
  int weight = static_cast<int>(a.fontWeight.value_or(FontWeight::Regular));
  pango_font_description_set_weight(font, static_cast<PangoWeight>(weight <= 0 ? 400 : weight));
  if (a.fontStyle.has_value() && *a.fontStyle != FontStyle::Normal) {
    pango_font_description_set_style(font, PANGO_STYLE_ITALIC);
  }
  return font;
}

TextLayout layoutText(const AttributedString &text, const ParagraphAttributes &paragraph, Float maxWidth, LineHeights lineHeights) {
  bool pangoLineHeight = lineHeights == LineHeights::Auto && pangoHasLineHeight();
  TextLayout result;
  result.layout = pango_layout_new(threadContext());
  PangoLayout *layout = result.layout;
  std::string utf8;
  PangoAttrList *attrs = pango_attr_list_new();
  std::optional<TextAlignment> alignment;
  // The paragraph's line height, the tallest any run asks for.
  double lineHeight = 0;
  for (const auto &fragment : text.getFragments()) {
    if (fragment.isAttachment()) {
      continue;
    }
    const auto &a = fragment.textAttributes;
    guint start = static_cast<guint>(utf8.size());
    utf8 += fragment.string;
    guint end = static_cast<guint>(utf8.size());
    PangoFontDescription *font = fontOf(a);
    addAttribute(attrs, pango_attr_font_desc_new(font), start, end);
    pango_font_description_free(font);
    if (a.foregroundColor) {
      auto c = colorComponentsFromColor(a.foregroundColor);
      addAttribute(attrs, pango_attr_foreground_new(channel(c.red), channel(c.green), channel(c.blue)), start, end);
      addAttribute(attrs, pango_attr_foreground_alpha_new(channel(c.alpha)), start, end);
    }
    if (!std::isnan(a.letterSpacing)) {
      addAttribute(attrs, pango_attr_letter_spacing_new(static_cast<int>(a.letterSpacing * PANGO_SCALE)), start, end);
    }
    if (!std::isnan(a.lineHeight) && a.lineHeight > 0) {
      double height = a.lineHeight * scaleOf(a);
      lineHeight = std::max(lineHeight, height);
#if PANGO_VERSION_CHECK(1, 50, 0)
      if (pangoLineHeight) {
        addAttribute(attrs, pango_attr_line_height_new_absolute(static_cast<int>(std::lround(height * PANGO_SCALE))), start, end);
      }
#endif
    }
    if (!alignment && a.alignment) {
      alignment = a.alignment;
    }
  }
  pango_layout_set_text(layout, utf8.c_str(), static_cast<int>(utf8.size()));
  pango_layout_set_attributes(layout, attrs);
  pango_attr_list_unref(attrs);
  if (std::isfinite(maxWidth)) {
    pango_layout_set_width(layout, static_cast<int>(maxWidth * PANGO_SCALE));
    pango_layout_set_wrap(layout, PANGO_WRAP_WORD_CHAR);
  }
  switch (alignment.value_or(TextAlignment::Natural)) {
    case TextAlignment::Center: pango_layout_set_alignment(layout, PANGO_ALIGN_CENTER); break;
    case TextAlignment::Right:
    case TextAlignment::End: pango_layout_set_alignment(layout, PANGO_ALIGN_RIGHT); break;
    case TextAlignment::Justified: pango_layout_set_justify(layout, TRUE); break;
    default: pango_layout_set_auto_dir(layout, TRUE); break;
  }
  if (paragraph.maximumNumberOfLines > 0) {
    pango_layout_set_height(layout, -paragraph.maximumNumberOfLines);
    pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_END);
  }

  PangoRectangle logical;
  pango_layout_get_extents(layout, nullptr, &logical);
  result.size = {static_cast<Float>(logical.width) / PANGO_SCALE, static_cast<Float>(logical.height) / PANGO_SCALE};
  if (lineHeight > 0 && !pangoLineHeight) {
    // Each line as tall as the paragraph's line height: the space between lines makes up the
    // difference from the lines' own height, and half of it goes above the first.
    int lines = std::max(1, pango_layout_get_line_count(layout));
    double natural = static_cast<double>(logical.height) / PANGO_SCALE / lines;
    double extra = lineHeight - natural;
    pango_layout_set_spacing(layout, static_cast<int>(std::lround(extra * PANGO_SCALE)));
    result.top = extra / 2;
    result.size.height = static_cast<Float>(lineHeight * lines);
  }
  return result;
}

Size PangoTextMeasurer::measure(const AttributedString &text, const ParagraphAttributes &paragraph, Float maxWidth) const {
  return layoutText(text, paragraph, maxWidth, lineHeights_).size;
}

float desktopFontScale() {
  int dpi = -1;
  if (GtkSettings *settings = gtk_settings_get_default()) {
    g_object_get(settings, "gtk-xft-dpi", &dpi, nullptr);
  }
  return xftFontScale(dpi);
}

void watchFontScale(std::function<void()> changed) {
  if (GtkSettings *settings = gtk_settings_get_default()) {
    g_signal_connect_data(
        settings, "notify::gtk-xft-dpi", G_CALLBACK(+[](GObject *, GParamSpec *, gpointer data) {
          (*static_cast<std::function<void()> *>(data))();
        }),
        new std::function<void()>(std::move(changed)),
        [](gpointer data, GClosure *) { delete static_cast<std::function<void()> *>(data); }, GConnectFlags(0));
  }
}

} // namespace ngn::gtk
