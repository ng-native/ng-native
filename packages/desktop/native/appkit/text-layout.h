// Core Text layout shared by measurement (CoreTextMeasurer, on the JS thread) and drawing
// (NGNView, on the main thread), so both break lines the same way.
#pragma once

#include "ngn/fonts.h"
#include "ngn/text-measurer.h"

#include <CoreText/CoreText.h>
#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <vector>

namespace ngn {

struct TextLine {
  CTLineRef line; // owned by the layout
  CGPoint origin; // baseline origin, y measured from the top of the text box
  CGFloat width;
};

struct TextLayout {
  CFAttributedStringRef string{nullptr};
  std::vector<TextLine> lines;
  CGSize size{};
  TextLayout() = default;
  TextLayout(const TextLayout &) = delete;
  TextLayout &operator=(const TextLayout &) = delete;
  TextLayout(TextLayout &&other) noexcept;
  ~TextLayout();
};

// The names fonts were loaded under (NgNativeFont), which text asks for by: one stands for the
// family of the font loaded under it. Set once, before any text is laid out.
void useFontLibrary(std::shared_ptr<const FontLibrary> library);

// The fragments' text attributes already carry the surface's font size multiplier.
CFAttributedStringRef makeAttributedString(const facebook::react::AttributedString &attributedString);

// Lays the string out at `maxWidth`, honouring numberOfLines and the ellipsize mode.
TextLayout layoutText(
    const facebook::react::AttributedString &attributedString,
    const facebook::react::ParagraphAttributes &paragraphAttributes,
    CGFloat maxWidth);

// Draws a layout into a flipped (top-left origin) context at `origin`.
void drawText(const TextLayout &layout, CGContextRef context, CGPoint origin, CGFloat boxWidth);

// The core's TextMeasurer, over the same layout the views draw.
class CoreTextMeasurer final : public TextMeasurer {
 public:
  facebook::react::Size measure(
      const facebook::react::AttributedString &text,
      const facebook::react::ParagraphAttributes &paragraph,
      facebook::react::Float maxWidth) const override;
};

} // namespace ngn
