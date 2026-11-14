// NgNativeScreenCapture: what @ng-native/expo's ScreenCapture calls on expo-screen-capture, over a
// CaptureShield, which the AppKit backend implements with every window's NSWindow.sharingType.
//
// - isAvailableAsync(): whether there is a shield.
// - preventScreenCaptureAsync(key), allowScreenCaptureAsync(key): capture stays prevented while
//   any key is held, `default` when none is given, as expo-screen-capture keeps its keys. The
//   shield changes only as the first key is taken and the last released, and a reload, which
//   ends the module, releases them all.
// - enableAppSwitcherProtectionAsync(), disableAppSwitcherProtectionAsync(): resolve; macOS shows
//   no snapshot of an app that is not in front.
// - getPermissionsAsync(), requestPermissionsAsync(): granted, as on iOS: nothing is asked.
#pragma once

#include "ngn/native-module.h"

#include <memory>

namespace ngn {

class CaptureShield {
 public:
  virtual ~CaptureShield() = default;
  // Keeps every window of the app, and every one it opens after, out of screenshots, recordings
  // and screen sharing; or lets them be captured again. Any thread.
  virtual void setProtected(bool on) = 0;
};

std::shared_ptr<NativeModule> makeScreenCaptureModule(std::shared_ptr<CaptureShield> shield);

} // namespace ngn
