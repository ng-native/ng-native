#include "ngn/text-input.h"
#include "ngn/desktop-view-props.h"

#include <react/renderer/components/iostextinput/conversions.h>
#include <react/renderer/components/iostextinput/propsConversions.h>
#include <react/renderer/core/propsConversions.h>

#include <algorithm>
#include <limits>

using namespace facebook::react;

namespace ngn {

extern const char DesktopTextInputComponentName[] = "TextInput";

DesktopTextInputProps::DesktopTextInputProps(
    const PropsParserContext &context,
    const DesktopTextInputProps &sourceProps,
    const RawProps &rawProps)
    : BaseTextInputProps(context, sourceProps, rawProps),
      traits(convertRawProp(context, rawProps, sourceProps.traits, {})),
      selection(convertRawProp(context, rawProps, "selection", sourceProps.selection, std::optional<Selection>())),
      smartQuotes(convertRawProp(context, rawProps, "smartQuotes", sourceProps.smartQuotes, std::optional<bool>())),
      accessibilityDescribedBy(convertRawProp(
          context, rawProps, "accessibilityDescribedBy", sourceProps.accessibilityDescribedBy, {})),
      aria(parseAriaFields(context, sourceProps.aria, rawProps)) {}

namespace {

Capitalize capitalize(AutocapitalizationType type) {
  switch (type) {
    case AutocapitalizationType::None:
      return Capitalize::None;
    case AutocapitalizationType::Words:
      return Capitalize::Words;
    case AutocapitalizationType::Characters:
      return Capitalize::Characters;
    case AutocapitalizationType::Sentences:
      return Capitalize::Sentences;
  }
  return Capitalize::Sentences;
}

} // namespace

TextInputOptions textInputOptions(const DesktopTextInputProps &props) {
  const auto &traits = props.traits;
  TextInputOptions options{
      .autoCorrect = traits.autoCorrect,
      .spellCheck = traits.spellCheck.has_value() ? traits.spellCheck : traits.autoCorrect,
      .smartQuotes = props.smartQuotes.has_value() ? props.smartQuotes : traits.autoCorrect,
      .smartInsertDelete = traits.smartInsertDelete,
      .capitalize = capitalize(traits.autocapitalizationType),
      .secure = traits.secureTextEntry,
  };
  if (props.maxLength >= 0 && props.maxLength != std::numeric_limits<int>::max()) {
    options.maxLength = static_cast<std::size_t>(props.maxLength);
  }
  if (options.secure) {
    options.autoCorrect = false;
    options.spellCheck = false;
    options.smartQuotes = false;
    options.smartInsertDelete = false;
    options.capitalize = Capitalize::None;
  }
  return options;
}

TextAlignment inputAlignment(std::optional<TextAlignment> alignment, LayoutDirection layoutDirection) {
  if (!alignment) {
    return layoutDirection == LayoutDirection::RightToLeft ? TextAlignment::Right : TextAlignment::Left;
  }
  switch (*alignment) {
    case TextAlignment::Center:
    case TextAlignment::Justified: return *alignment;
    case TextAlignment::Right:
    case TextAlignment::End: return TextAlignment::Right;
    default: return TextAlignment::Left;
  }
}

std::size_t insertionThatFits(
    std::size_t current,
    std::size_t replaced,
    std::size_t inserted,
    std::optional<std::size_t> maxLength) {
  if (!maxLength) {
    return inserted;
  }
  std::size_t kept = current - std::min(replaced, current);
  if (kept >= *maxLength) {
    return 0;
  }
  return std::min(inserted, *maxLength - kept);
}

bool isTextSpace(char16_t unit) {
  return (unit >= 0x09 && unit <= 0x0D) || unit == 0x20 || unit == 0x85 || unit == 0xA0 || unit == 0x1680 ||
      (unit >= 0x2000 && unit <= 0x200A) || unit == 0x2028 || unit == 0x2029 || unit == 0x202F || unit == 0x205F ||
      unit == 0x3000;
}

std::u16string fitReplacement(
    const std::u16string &current,
    std::size_t location,
    std::size_t length,
    const std::u16string &replacement,
    const TextInputOptions &options,
    const TextCharacters &characters) {
  std::u16string out;
  if (options.capitalize == Capitalize::Characters) {
    out = characters.uppercase(replacement);
  } else if (options.capitalize == Capitalize::Words) {
    location = std::min(location, current.size());
    bool wordStart = location == 0 || isTextSpace(current[location - 1]);
    for (std::size_t at = 0; at < replacement.size();) {
      auto [start, size] = characters.characterAt(replacement, at);
      size = std::max<std::size_t>(size, 1);
      auto piece = replacement.substr(at, start + size - at);
      bool space = isTextSpace(piece[0]);
      out += wordStart && !space ? characters.uppercase(piece) : piece;
      wordStart = space;
      at += piece.size();
    }
  } else {
    out = replacement;
  }
  auto fits = insertionThatFits(current.size(), length, out.size(), options.maxLength);
  if (fits < out.size()) {
    if (fits > 0) {
      fits = characters.characterAt(out, fits).first;
    }
    out.resize(fits);
  }
  return out;
}

bool controlledTextIsCurrent(int mostRecentEventCount, int fieldEventCount, bool composing) {
  return mostRecentEventCount >= fieldEventCount && !composing;
}

std::optional<std::pair<int, int>> newSelection(const DesktopTextInputProps *before, const DesktopTextInputProps &now) {
  if (!now.selection) {
    return std::nullopt;
  }
  if (before && before->selection && before->selection->start == now.selection->start &&
      before->selection->end == now.selection->end) {
    return std::nullopt;
  }
  int start = std::max(0, std::min(now.selection->start, now.selection->end));
  int end = std::max(0, std::max(now.selection->start, now.selection->end));
  return std::make_pair(start, end);
}

} // namespace ngn
