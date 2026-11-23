// The platform controls a desktop host draws, as Fabric components: `<native-button>`
// (NgNativeButton), `<switch>` (Switch), `<activity-indicator>` (ActivityIndicatorView),
// `<segmented-control>` (RNCSegmentedControl), `<date-time-picker>` (RNDateTimePicker) and
// `<search-field>` (`@ng-native/expo`'s NgNativeSearchField view).
//
// Every control has the same props class, the union of what the elements commit, and measures its
// intrinsic size for Yoga as a toolkit draws it at its `controlSize`. A toolkit measures on its UI
// thread only, so layout reads the sizes the ControlSizes in the ContextContainer holds
// (control-sizes.h). A size the app sets in its style wins, as it does for any leaf.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/graphics/Color.h>
#include <react/utils/ContextContainer.h>

#include <optional>
#include <string_view>
#include <string>
#include <vector>

namespace ngn {

enum class ControlKind { Button, Switch, ActivityIndicator, SegmentedControl, DatePicker, SearchField };

// AppKit's control sizes, and UIKit's on iOS 26 and later.
enum class ControlSize { Mini, Small, Regular, Large };

class NativeControlProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  NativeControlProps() = default;
  NativeControlProps(
      const facebook::react::PropsParserContext &context,
      const NativeControlProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  ControlSize controlSize{ControlSize::Regular};
  // False for `enabled: false` or `disabled: true`, whichever the element commits.
  bool enabled{true};

  // Button.
  std::string title;
  // `default`, `cancel`, `destructive` or `plain`, or empty when the element sets none.
  std::string kind;
  std::string sfSymbol;
  // An icon's SVG markup (ngn/svg-markup.h), drawn where there is no SF Symbol.
  std::string svgIcon;

  // Switch.
  bool value{false};

  // Activity indicator.
  bool animating{true};
  bool hidesWhenStopped{true};
  // `small` or `large`.
  std::string size{"small"};
  facebook::react::SharedColor color;

  // Segmented control.
  std::vector<std::string> values;
  int selectedIndex{-1};
  bool momentary{false};

  // Date picker: milliseconds since the epoch.
  std::optional<double> date;
  std::optional<double> minimumDate;
  std::optional<double> maximumDate;
  // `date`, `time`, `datetime` or `countdown`.
  std::string mode{"date"};
  // The minutes a time is picked in steps of (iOS's minuteInterval): 1 to 30, dividing 60.
  int minuteInterval{1};
  // `default`, `spinner`, `compact` or `inline`.
  std::string display{"default"};

  // Search field: the text JavaScript holds, and the keystroke it answers (React Native's text
  // input rule: a text older than what has been typed since is skipped).
  std::string text;
  int mostRecentEventCount{0};
  std::string placeholder;
  std::string autoCapitalize;
  facebook::react::SharedColor tintColor;
  // The face, size, weight (CSS's 100 to 900) and slant the field's CSS resolves to; unset is the
  // control's own font.
  std::string fontFamily;
  std::optional<double> fontSize;
  std::optional<int> fontWeight;
  bool italic{false};
};

// How big a toolkit draws a control. Called on the UI thread only, by ControlSizes.
class ControlMeasurer {
 public:
  virtual ~ControlMeasurer() = default;
  virtual facebook::react::Size measure(ControlKind kind, const NativeControlProps &props) const = 0;
};

// A control's state: how many times a measurement made after its layout has asked for another.
// Each one is a state update, which lays the control out again with the size (control-sizes.h).
struct NativeControlState {
  int measured{0};
};

// The size layout gives a control: the one ControlSizes holds for its inputs (control-sizes.cpp),
// at the text size multiplier the layout runs with.
facebook::react::Size measureControl(
    const facebook::react::ShadowNode &node,
    ControlKind kind,
    const facebook::react::ContextContainer *context,
    float fontScale);

// The control a Fabric component name is, if it is one.
std::optional<ControlKind> controlKind(std::string_view componentName);

extern const char NativeButtonComponentName[];
extern const char SwitchControlComponentName[];
extern const char ActivityIndicatorControlComponentName[];
extern const char SegmentedControlComponentName[];
extern const char DatePickerComponentName[];
extern const char SearchFieldComponentName[];

template <const char *Name, ControlKind Kind>
class NativeControlShadowNode final : public facebook::react::ConcreteViewShadowNode<
                                          Name,
                                          NativeControlProps,
                                          facebook::react::ViewEventEmitter,
                                          NativeControlState> {
  using Base = facebook::react::
      ConcreteViewShadowNode<Name, NativeControlProps, facebook::react::ViewEventEmitter, NativeControlState>;

 public:
  using Base::Base;

  static facebook::react::ShadowNodeTraits BaseTraits() {
    auto traits = Base::BaseTraits();
    traits.set(facebook::react::ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(facebook::react::ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  facebook::react::Size measureContent(
      const facebook::react::LayoutContext &layoutContext,
      const facebook::react::LayoutConstraints &layoutConstraints) const override {
    const auto &context = this->getContextContainer();
    return layoutConstraints.clamp(measureControl(*this, Kind, context.get(), layoutContext.fontSizeMultiplier));
  }
};

template <const char *Name, ControlKind Kind>
using NativeControlComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<NativeControlShadowNode<Name, Kind>>;

// Whether a strftime time format, as the C library's locale gives it (nl_langinfo(T_FMT)), writes a
// 12-hour clock: it has %I, %l, %r, %p or %P. A date picker's time follows it on Linux.
bool twelveHourClock(std::string_view timeFormat);
// The hour of the day, 0 to 23, for an hour on a 12-hour clock (1 to 12) in the morning or after
// noon; and the 12-hour clock's hour for an hour of the day.
int dayHour(int clockHour, bool afterNoon);
int clockHour(int dayHour);
// GNOME's clock-format (org.gnome.desktop.interface, through the settings portal): true for
// `12h`, false for `24h`, nothing for anything else, where the locale's format decides.
std::optional<bool> clockFormatTwelveHour(std::string_view clockFormat);
// A minuteInterval as UIDatePicker takes it: one that does not divide 60 evenly, or is outside 1
// to 30, is 1. And a minute rounded down to it, as the picker shows a time between two steps.
int pickerMinuteInterval(int minuteInterval);
int minuteOnInterval(int minute, int minuteInterval);

using NativeButtonComponentDescriptor = NativeControlComponentDescriptor<NativeButtonComponentName, ControlKind::Button>;
using SwitchControlComponentDescriptor =
    NativeControlComponentDescriptor<SwitchControlComponentName, ControlKind::Switch>;
using ActivityIndicatorControlComponentDescriptor =
    NativeControlComponentDescriptor<ActivityIndicatorControlComponentName, ControlKind::ActivityIndicator>;
using SegmentedControlComponentDescriptor =
    NativeControlComponentDescriptor<SegmentedControlComponentName, ControlKind::SegmentedControl>;
using DatePickerComponentDescriptor = NativeControlComponentDescriptor<DatePickerComponentName, ControlKind::DatePicker>;
using SearchFieldComponentDescriptor =
    NativeControlComponentDescriptor<SearchFieldComponentName, ControlKind::SearchField>;

} // namespace ngn
