#include "ngn/native-controls.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

const char NativeButtonComponentName[] = "NgNativeButton";
const char SwitchControlComponentName[] = "Switch";
const char ActivityIndicatorControlComponentName[] = "ActivityIndicatorView";
const char SegmentedControlComponentName[] = "RNCSegmentedControl";
const char DatePickerComponentName[] = "RNDateTimePicker";

void fromRawValue(const PropsParserContext &, const RawValue &value, ControlSize &result) {
  auto keyword = value.hasType<std::string>() ? static_cast<std::string>(value) : std::string{};
  result = keyword == "mini"    ? ControlSize::Mini
      : keyword == "small"      ? ControlSize::Small
      : keyword == "large"      ? ControlSize::Large
                                : ControlSize::Regular;
}

namespace {

// `enabled` (the button's, the segmented control's) or `disabled` (React Native's switch and
// activity indicator), whichever the update sets.
bool enabledFrom(const PropsParserContext &context, const RawProps &rawProps, bool source) {
  if (const auto *enabled = rawProps.at("enabled", nullptr, nullptr)) {
    return enabled->hasType<bool>() ? static_cast<bool>(*enabled) : true;
  }
  if (const auto *disabled = rawProps.at("disabled", nullptr, nullptr)) {
    return disabled->hasType<bool>() ? !static_cast<bool>(*disabled) : true;
  }
  return source;
}

} // namespace

NativeControlProps::NativeControlProps(
    const PropsParserContext &context,
    const NativeControlProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      controlSize(convertRawProp(context, rawProps, "controlSize", sourceProps.controlSize, ControlSize::Regular)),
      enabled(enabledFrom(context, rawProps, sourceProps.enabled)),
      title(convertRawProp(context, rawProps, "title", sourceProps.title, {})),
      kind(convertRawProp(context, rawProps, "kind", sourceProps.kind, std::string{"default"})),
      sfSymbol(convertRawProp(context, rawProps, "sfSymbol", sourceProps.sfSymbol, {})),
      value(convertRawProp(context, rawProps, "value", sourceProps.value, false)),
      animating(convertRawProp(context, rawProps, "animating", sourceProps.animating, true)),
      hidesWhenStopped(convertRawProp(context, rawProps, "hidesWhenStopped", sourceProps.hidesWhenStopped, true)),
      size(convertRawProp(context, rawProps, "size", sourceProps.size, std::string{"small"})),
      color(convertRawProp(context, rawProps, "color", sourceProps.color, {})),
      values(convertRawProp(context, rawProps, "values", sourceProps.values, {})),
      selectedIndex(convertRawProp(context, rawProps, "selectedIndex", sourceProps.selectedIndex, -1)),
      momentary(convertRawProp(context, rawProps, "momentary", sourceProps.momentary, false)),
      date(convertRawProp(context, rawProps, "date", sourceProps.date, {})),
      minimumDate(convertRawProp(context, rawProps, "minimumDate", sourceProps.minimumDate, {})),
      maximumDate(convertRawProp(context, rawProps, "maximumDate", sourceProps.maximumDate, {})),
      mode(convertRawProp(context, rawProps, "mode", sourceProps.mode, std::string{"date"})),
      display(convertRawProp(context, rawProps, "displayIOS", sourceProps.display, std::string{"default"})) {}

std::optional<ControlKind> controlKind(std::string_view componentName) {
  if (componentName == NativeButtonComponentName) {
    return ControlKind::Button;
  }
  if (componentName == SwitchControlComponentName) {
    return ControlKind::Switch;
  }
  if (componentName == ActivityIndicatorControlComponentName) {
    return ControlKind::ActivityIndicator;
  }
  if (componentName == SegmentedControlComponentName) {
    return ControlKind::SegmentedControl;
  }
  if (componentName == DatePickerComponentName) {
    return ControlKind::DatePicker;
  }
  return std::nullopt;
}

} // namespace ngn
