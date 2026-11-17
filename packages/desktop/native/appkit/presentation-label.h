// The name VoiceOver gives a sheet, cover or popover: its container's accessibility label.
#pragma once

#import <AppKit/AppKit.h>

#include <string_view>

namespace ngn::appkit {

// Labels `container` with the presented view's own accessibility label, or without one its title
// (ngn::presentationLabel), and clears the label when there is neither. Called when the
// presentation opens and again whenever the label or the title changes.
void labelPresentation(NSView *container, std::string_view label, std::string_view title);

} // namespace ngn::appkit
