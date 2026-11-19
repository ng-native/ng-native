// React Native's cxx TextLayoutManager, implemented once for every backend over its TextMeasurer.
// The header is React Native's (platform/cxx); its stub .cpp leaves the build (react-native.cmake).
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

#include <react/renderer/attributedstring/PlaceholderAttributedString.h>

#include "ngn/text-measurer.h"

#include <cmath>

namespace facebook::react {

TextLayoutManager::TextLayoutManager(const std::shared_ptr<const ContextContainer> &contextContainer)
    : contextContainer_(contextContainer), textMeasureCache_(kSimpleThreadSafeCacheSizeCap) {}

TextMeasurement TextLayoutManager::measure(
    const AttributedStringBox &attributedStringBox,
    const ParagraphAttributes &paragraphAttributes,
    const TextLayoutContext &layoutContext,
    const LayoutConstraints &layoutConstraints) const {
  // An empty string is measured as "I" with its attributes, and kept no wider than nothing, as
  // React Native iOS does, so an empty text input is a line of its font high.
  const auto &original = attributedStringBox.getValue();
  auto attributedString = ensurePlaceholderIfEmpty_DO_NOT_USE(original);
  auto measurer = contextContainer_
      ? contextContainer_->find<std::shared_ptr<const ngn::TextMeasurer>>(ngn::kTextMeasurerKey)
      : std::nullopt;
  bool measures = measurer && *measurer;
  auto compute = [&]() {
    // The measurer lays out no inline views or images: each one is reported clipped, which hides
    // it, rather than drawn over the text at the paragraph's corner.
    TextMeasurement::Attachments attachments;
    for (const auto &fragment : attributedString.getFragments()) {
      if (fragment.isAttachment()) {
        attachments.push_back({.frame = {}, .isClipped = true});
      }
    }
    Size size{};
    if (measures) {
      size = (*measurer)->measure(attributedString, paragraphAttributes, layoutConstraints.maximumSize.width);
      if (original.isEmpty()) {
        size.width = 0;
      }
      // Round up to the device pixel, as React Native iOS does, so the box never clips a glyph.
      Float scale = layoutContext.pointScaleFactor > 0 ? layoutContext.pointScaleFactor : 1;
      size = {std::ceil(size.width * scale) / scale, std::ceil(size.height * scale) / scale};
    }
    return TextMeasurement{.size = layoutConstraints.clamp(size), .attachments = attachments};
  };
  // Before a measurer is installed every text is nothing wide: that is never kept for later.
  if (!measures) {
    return compute();
  }
  // Keyed by the text as given, so an empty one and a visible "I" never share a size.
  return textMeasureCache_.get(
      {.attributedString = original,
       .paragraphAttributes = paragraphAttributes,
       .layoutConstraints = layoutConstraints,
       .pointScaleFactor = layoutContext.pointScaleFactor},
      compute);
}

LinesMeasurements TextLayoutManager::measureLines(
    const AttributedStringBox &attributedStringBox,
    const ParagraphAttributes &paragraphAttributes,
    const Size &size) const {
  auto measurer = contextContainer_
      ? contextContainer_->find<std::shared_ptr<const ngn::TextMeasurer>>(ngn::kTextMeasurerKey)
      : std::nullopt;
  if (!measurer || !*measurer) {
    return {};
  }
  return (*measurer)->lines(attributedStringBox.getValue(), paragraphAttributes, size.width);
}

} // namespace facebook::react
