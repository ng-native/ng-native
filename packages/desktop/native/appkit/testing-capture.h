// The AppKit half of NgNativeTesting (the core's testing-capture.h): the app's window drawn in
// process, its content view cached into a bitmap as printing draws it, so a capture asks for no
// screen recording permission, unlike `screencapture -l`.
#pragma once

#include "ngn/testing-capture.h"

#include <cstdint>
#include <functional>
#include <memory>

@class NSView;
@class NSWindow;

namespace ngn::appkit {

// `window` is the app's window, or nil before it has one; `viewForTag` the view with a tag, or nil.
// Both on the main thread.
std::shared_ptr<WindowCapture> makeWindowCapture(
    std::function<NSWindow *()> window, std::function<NSView *(int64_t tag)> viewForTag);

} // namespace ngn::appkit
