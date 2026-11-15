// NgNativeScreenCapture: what @ng-native/expo's ScreenCapture calls on expo-screen-capture, over a
// CaptureShield, which the AppKit backend implements with every window's NSWindow.sharingType.
//
// - isAvailableAsync(): whether there is a shield.
// - preventScreenCaptureAsync(key), allowScreenCaptureAsync(key): capture stays prevented while
//   any key is held, `default` when none is given, as expo-screen-capture keeps its keys. The
//   shield changes only as the first key is taken and the last released, and a reload, which
//   ends the module, releases them all. Each resolves once the windows have the state it asks
//   for.
// - enableAppSwitcherProtectionAsync(), disableAppSwitcherProtectionAsync(): resolve; macOS shows
//   no snapshot of an app that is not in front.
// - getPermissionsAsync(), requestPermissionsAsync(): granted, as on iOS: nothing is asked.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>

namespace ngn {

class CaptureShield {
 public:
  virtual ~CaptureShield() = default;
  // Marks every window of the app, and every one it opens after, as one whose content another
  // process may not read, as far as the OS offers that (on macOS, NSWindowSharingNone; which
  // capture tools honour it is the OS's to decide); or lets them be read again. `done` once every
  // window has the new state, or a later request's, on any thread; it may be empty. Any thread: the
  // windows keep the state of the request asked last.
  virtual void setProtected(bool on, std::function<void()> done) = 0;
};

std::shared_ptr<NativeModule> makeScreenCaptureModule(std::shared_ptr<CaptureShield> shield);

} // namespace ngn
