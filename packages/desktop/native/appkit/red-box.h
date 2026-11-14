// The OS half of the dev red box (the core's red-box.h): a red window over the app's, as React
// Native iOS's RCTRedBox covers its window, with the error's message, its stack, and Dismiss
// (Escape), Reload (Command-R), Copy and, with more than one error kept, the arrows between them.
#pragma once

#include "ngn/red-box.h"

#include <functional>
#include <memory>

namespace ngn::appkit {

struct RedBoxActions {
  std::function<void()> dismiss;
  std::function<void()> reload;
  std::function<void(int delta)> step;
};

std::shared_ptr<RedBoxBackend> makeRedBoxWindow(RedBoxActions actions);

// React Native DevTools' pause, as React Native iOS overlays it: "Paused in debugger" and a
// resume button, over the top of the app's window while the JavaScript is paused. Any thread.
void showDebuggerPaused(std::function<void()> resume);
void hideDebuggerPaused();

} // namespace ngn::appkit
