// The native controls of native-controls.h as AppKit draws them: NSButton, NSSwitch,
// NSProgressIndicator, NSSegmentedControl and NSDatePicker, each filling its Fabric view, and the
// measurer that tells Yoga how big each one is at its control size.
#pragma once

#import "host-view.h"

#include "ngn/native-controls.h"

// The view for a native control's component name, or nil for any other.
NGNView *NGNMakeControlView(const facebook::react::ShadowView &view);

namespace ngn::appkit {

// Sizes the controls with AppKit's cells, which are safe to make off the main thread, and with
// sizes read once on the main thread for the controls that have no cell.
class AppKitControlMeasurer final : public ControlMeasurer {
 public:
  // On the main thread.
  AppKitControlMeasurer();
  facebook::react::Size measure(ControlKind kind, const NativeControlProps &props) const override;

 private:
  facebook::react::Size switches_[4];
  facebook::react::Size spinners_[4];
};

} // namespace ngn::appkit
