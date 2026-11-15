// The native controls of native-controls.h as AppKit draws them: NSButton, NSSwitch,
// NSProgressIndicator, NSSegmentedControl, NSDatePicker and NSSearchField, each filling its Fabric
// view, and the measurer that tells Yoga how big each one is at its control size.
#pragma once

#import "host-view.h"

#include "ngn/native-controls.h"

// The view for a native control's component name, or nil for any other.
NGNView *NGNMakeControlView(const facebook::react::ShadowView &view);

namespace ngn::appkit {

// Sizes the controls with AppKit's cells and views, on the main thread only (ControlSizes calls it
// there, and layout reads what it measured).
class AppKitControlMeasurer final : public ControlMeasurer {
 public:
  facebook::react::Size measure(ControlKind kind, const NativeControlProps &props) const override;
};

} // namespace ngn::appkit
