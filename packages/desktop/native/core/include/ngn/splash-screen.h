// The splash screen on macOS: the app's first windows, held hidden. A Mac app has no launch
// screen; its windows show when their first frame mounts. Holding the splash keeps them hidden
// past that, until the app hides the splash, so an app that loads fonts or data first never shows
// a window that is empty or set in the fallback face.
//
// NgNativeSplashScreen, what @ng-native/expo's splashScreen calls on expo-splash-screen:
// - preventAutoHideAsync(): holds the windows; true, or false once a window has already shown,
//   when it is too late to hold anything, as expo-splash-screen answers once its screen is gone.
// - hideAsync(), hide(): shows the windows held, in the order they were ready.
// A reload, which ends the module, lets the windows go too.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <mutex>
#include <vector>

namespace ngn {

class SplashGate {
 public:
  // Holds what `show` is given from now on; false, holding nothing, once anything has shown.
  bool hold();
  // Runs the shows held, in order, and lets every later one run at once.
  void release();
  // Runs `show` now, or once the hold is released. On the caller's thread, or release()'s.
  void show(std::function<void()> show);
  bool held();

 private:
  std::mutex mutex_;
  bool held_{false};
  bool shown_{false};
  std::vector<std::function<void()>> waiting_;
};

std::shared_ptr<NativeModule> makeSplashScreenModule(std::shared_ptr<SplashGate> gate);

} // namespace ngn
