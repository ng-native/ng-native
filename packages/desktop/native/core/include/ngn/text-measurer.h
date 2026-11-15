// The text measurement interface: how big a toolkit lays a paragraph out.
//
// React Native's TextLayoutManager (the cxx header) is implemented in the core, which keeps the
// measure cache, attachments, constraint clamping and rounding to the device pixel for every
// backend, and asks the TextMeasurer found in the ContextContainer only for the raw size.
#pragma once

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/graphics/Size.h>
#include <react/utils/ContextContainer.h>

#include <memory>

namespace ngn {

class TextMeasurer {
 public:
  virtual ~TextMeasurer() = default;

  // The unrounded size of the laid-out text, at most `maxWidth` wide (which may be infinite).
  // Called on the JS thread, concurrently with drawing on the UI thread.
  virtual facebook::react::Size measure(
      const facebook::react::AttributedString &text,
      const facebook::react::ParagraphAttributes &paragraph,
      facebook::react::Float maxWidth) const = 0;
};

// The ContextContainer key the core's TextLayoutManager reads the measurer from.
inline constexpr const char *kTextMeasurerKey = "ngn.TextMeasurer";

inline void installTextMeasurer(
    facebook::react::ContextContainer &context,
    std::shared_ptr<const TextMeasurer> measurer) {
  context.insert(kTextMeasurerKey, std::move(measurer));
}

} // namespace ngn
