// Text through Pango, shared by measurement (PangoTextMeasurer, on the JS thread) and drawing (a
// Paragraph's view, on the GTK thread), so both break the lines the same way.
//
// `lineHeight` is Pango's own attribute from Pango 1.50. Below it (el9 ships 1.48) the layout
// spaces its lines itself: each line takes the paragraph's line height, its extra split above and
// below, as CSS and Pango 1.50 both place it.
#pragma once

#include <functional>

#include "ngn/text-measurer.h"

#include <pango/pangocairo.h>

namespace ngn::gtk {

enum class LineHeights {
  // Pango's attribute when the Pango running has it, our own spacing when not.
  Auto,
  // Our own spacing whatever Pango runs: what Pango below 1.50 gets, and what tests compare.
  Own,
};

struct TextLayout {
  // Owned: freed with the TextLayout.
  PangoLayout *layout{nullptr};
  // Where the layout's top goes below the content box's: half of each line's extra height when
  // the layout spaces its own lines.
  double top{0};
  facebook::react::Size size{};

  TextLayout() = default;
  TextLayout(const TextLayout &) = delete;
  TextLayout &operator=(const TextLayout &) = delete;
  TextLayout(TextLayout &&other) noexcept;
  TextLayout &operator=(TextLayout &&other) noexcept;
  ~TextLayout();
};

// The string laid out at most `maxWidth` wide (infinite for no limit), in a context of the calling
// thread's Pango cairo font map, with metrics unhinted so that a size does not depend on the scale
// it is drawn at.
TextLayout layoutText(
    const facebook::react::AttributedString &text,
    const facebook::react::ParagraphAttributes &paragraph,
    facebook::react::Float maxWidth,
    LineHeights lineHeights = LineHeights::Auto);

// Whether the Pango running has the line-height attribute.
bool pangoHasLineHeight();

// The text size multiplier the desktop asks for, from GtkSettings' `gtk-xft-dpi` (xftFontScale),
// and `changed` called each time it changes, for as long as the process runs.
float desktopFontScale();
void watchFontScale(std::function<void()> changed);

// The font a run of text attributes resolves to. The caller frees it.
PangoFontDescription *fontOf(const facebook::react::TextAttributes &attributes);

class PangoTextMeasurer final : public TextMeasurer {
 public:
  explicit PangoTextMeasurer(LineHeights lineHeights = LineHeights::Auto) : lineHeights_(lineHeights) {}

  facebook::react::Size measure(
      const facebook::react::AttributedString &text,
      const facebook::react::ParagraphAttributes &paragraph,
      facebook::react::Float maxWidth) const override;

 private:
  LineHeights lineHeights_;
};

} // namespace ngn::gtk
