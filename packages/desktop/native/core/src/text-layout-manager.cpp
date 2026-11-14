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
  auto compute = [&]() {
    TextMeasurement::Attachments attachments;
    for (const auto &fragment : attributedString.getFragments()) {
      if (fragment.isAttachment()) {
        attachments.push_back({.frame = {}, .isClipped = true});
      }
    }
    Size size{};
    auto measurer = contextContainer_
        ? contextContainer_->find<std::shared_ptr<const ngn::TextMeasurer>>(ngn::kTextMeasurerKey)
        : std::nullopt;
    if (measurer && *measurer) {
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
  return textMeasureCache_.get(
      {.attributedString = attributedString,
       .paragraphAttributes = paragraphAttributes,
       .layoutConstraints = layoutConstraints,
       .pointScaleFactor = layoutContext.pointScaleFactor},
      compute);
}

} // namespace facebook::react
