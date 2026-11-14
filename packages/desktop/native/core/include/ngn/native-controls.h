// The platform controls a desktop host draws, as Fabric components: `<native-button>`
// (NgNativeButton), `<switch>` (Switch), `<activity-indicator>` (ActivityIndicatorView),
// `<segmented-control>` (RNCSegmentedControl) and `<date-time-picker>` (RNDateTimePicker).
//
// Every control has the same props class, the union of what the elements commit, and measures its
// intrinsic size for Yoga through the ControlMeasurer in the ContextContainer, as a toolkit draws
// it at its `controlSize`. A size the app sets in its style wins, as it does for any leaf.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/graphics/Color.h>
#include <react/utils/ContextContainer.h>

#include <optional>
#include <string>
#include <vector>

namespace ngn {

enum class ControlKind { Button, Switch, ActivityIndicator, SegmentedControl, DatePicker };

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
  // `default`, `cancel`, `destructive` or `plain`.
  std::string kind{"default"};
  std::string sfSymbol;

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
  // `default`, `spinner`, `compact` or `inline`.
  std::string display{"default"};
};

// How big a toolkit draws a control. Called on the JS thread, while the UI thread draws.
class ControlMeasurer {
 public:
  virtual ~ControlMeasurer() = default;
  virtual facebook::react::Size measure(ControlKind kind, const NativeControlProps &props) const = 0;
};

inline constexpr const char *kControlMeasurerKey = "ngn.ControlMeasurer";

inline void installControlMeasurer(
    facebook::react::ContextContainer &context,
    std::shared_ptr<const ControlMeasurer> measurer) {
  context.insert(kControlMeasurerKey, std::move(measurer));
}

// The control a Fabric component name is, if it is one.
std::optional<ControlKind> controlKind(std::string_view componentName);

extern const char NativeButtonComponentName[];
extern const char SwitchControlComponentName[];
extern const char ActivityIndicatorControlComponentName[];
extern const char SegmentedControlComponentName[];
extern const char DatePickerComponentName[];

template <const char *Name, ControlKind Kind>
class NativeControlShadowNode final
    : public facebook::react::
          ConcreteViewShadowNode<Name, NativeControlProps, facebook::react::ViewEventEmitter> {
  using Base = facebook::react::ConcreteViewShadowNode<Name, NativeControlProps, facebook::react::ViewEventEmitter>;

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
    auto measurer =
        context ? context->template find<std::shared_ptr<const ControlMeasurer>>(kControlMeasurerKey) : std::nullopt;
    if (!measurer || !*measurer) {
      return layoutConstraints.clamp({0, 0});
    }
    return layoutConstraints.clamp((*measurer)->measure(Kind, this->getConcreteProps()));
  }
};

template <const char *Name, ControlKind Kind>
using NativeControlComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<NativeControlShadowNode<Name, Kind>>;

using NativeButtonComponentDescriptor = NativeControlComponentDescriptor<NativeButtonComponentName, ControlKind::Button>;
using SwitchControlComponentDescriptor =
    NativeControlComponentDescriptor<SwitchControlComponentName, ControlKind::Switch>;
using ActivityIndicatorControlComponentDescriptor =
    NativeControlComponentDescriptor<ActivityIndicatorControlComponentName, ControlKind::ActivityIndicator>;
using SegmentedControlComponentDescriptor =
    NativeControlComponentDescriptor<SegmentedControlComponentName, ControlKind::SegmentedControl>;
using DatePickerComponentDescriptor = NativeControlComponentDescriptor<DatePickerComponentName, ControlKind::DatePicker>;

} // namespace ngn
