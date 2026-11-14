// What a test launch changes in the AppKit host (`TestLaunch` in launch-settings.h): windows shown
// without taking focus and no Dock icon until a test asks for the key window, the app's preferences
// in a defaults suite of the run's own, and what the run leaves behind removed as it ends.
#pragma once

#include "ngn/launch-settings.h"

#import <AppKit/AppKit.h>

#include <functional>
#include <optional>

namespace ngn::appkit {

// Set once by main before anything below is read: the launch's test settings, or nothing. Creates
// the state directory's folders and points TMPDIR at its tmp.
void beginTestLaunch(const std::optional<TestLaunch> &test);
// The test launch the host runs as, or nothing.
const std::optional<TestLaunch> &testLaunch();

// Where the app's preferences go: the run's suite in a test launch, the standard defaults otherwise.
NSUserDefaults *appDefaults();

// Shows a window: key and in front, or in a test launch in front of other apps' windows without
// becoming key or activating the app.
void showWindow(NSWindow *window);
// Brings the app to the front with `window` key. In a test launch the app first becomes a regular
// app with a Dock icon, which it was not until a test asked for the key window.
void activateWith(NSWindow *window);

// Runs at the end of a test launch, on a clean quit or SIGTERM: what the run must not leave behind.
void onTestLaunchEnd(std::function<void()> cleanup);
// Removes what the run leaves behind (each onTestLaunchEnd, and the run's defaults suite), once.
void endTestLaunch();

} // namespace ngn::appkit
