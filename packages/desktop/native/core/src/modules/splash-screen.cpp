#include "ngn/splash-screen.h"

namespace ngn {

bool SplashGate::hold() {
  std::lock_guard lock(mutex_);
  if (shown_) {
    return false;
  }
  held_ = true;
  return true;
}

void SplashGate::release() {
  std::vector<std::function<void()>> waiting;
  {
    std::lock_guard lock(mutex_);
    held_ = false;
    waiting.swap(waiting_);
  }
  for (auto &show : waiting) {
    show();
  }
}

void SplashGate::show(std::function<void()> show) {
  {
    std::lock_guard lock(mutex_);
    if (held_) {
      waiting_.push_back(std::move(show));
      return;
    }
    shown_ = true;
  }
  show();
}

bool SplashGate::held() {
  std::lock_guard lock(mutex_);
  return held_;
}

std::shared_ptr<NativeModule> makeSplashScreenModule(std::shared_ptr<SplashGate> gate) {
  struct SplashScreen : NativeModule {
    std::shared_ptr<SplashGate> gate;
    explicit SplashScreen(std::shared_ptr<SplashGate> from) : NativeModule("NgNativeSplashScreen"), gate(std::move(from)) {
      auto splash = gate;
      promise("preventAutoHideAsync", [splash](const folly::dynamic &, JsPromise promise) { promise.resolve(splash->hold()); });
      promise("hideAsync", [splash](const folly::dynamic &, JsPromise promise) {
        splash->release();
        promise.resolve(nullptr);
      });
      sync("hide", [splash](const folly::dynamic &) {
        splash->release();
        return folly::dynamic(nullptr);
      });
    }
    ~SplashScreen() override {
      // A reloaded app is no reason to keep its windows hidden.
      gate->release();
    }
  };
  return std::make_shared<SplashScreen>(std::move(gate));
}

} // namespace ngn
