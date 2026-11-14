#include "ngn/text-input.h"

#include <react/renderer/components/iostextinput/conversions.h>
#include <react/renderer/components/iostextinput/propsConversions.h>
#include <react/renderer/core/propsConversions.h>

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
      smartQuotes(convertRawProp(context, rawProps, "smartQuotes", sourceProps.smartQuotes, std::optional<bool>())) {}

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

} // namespace ngn
