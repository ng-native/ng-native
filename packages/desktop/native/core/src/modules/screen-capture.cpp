#include "ngn/screen-capture.h"

#include <mutex>
#include <set>

namespace ngn {

std::shared_ptr<NativeModule> makeScreenCaptureModule(std::shared_ptr<CaptureShield> shield) {
  struct ScreenCapture : NativeModule {
    struct Keys {
      std::mutex mutex;
      std::set<std::string> held;
    };
    std::shared_ptr<CaptureShield> shield;
    std::shared_ptr<Keys> keys = std::make_shared<Keys>();

    explicit ScreenCapture(std::shared_ptr<CaptureShield> from) : NativeModule("NgNativeScreenCapture"), shield(std::move(from)) {
      auto state = keys;
      auto guard = shield;
      auto keyOf = [](const folly::dynamic &args) {
        return !args.empty() && args[0].isString() ? args[0].asString() : std::string("default");
      };
      promise("isAvailableAsync", [guard](const folly::dynamic &, JsPromise promise) { promise.resolve(guard != nullptr); });
      promise("preventScreenCaptureAsync", [state, guard, keyOf](const folly::dynamic &args, JsPromise promise) {
        {
          std::lock_guard lock(state->mutex);
          state->held.insert(keyOf(args));
        }
        if (!guard) {
          promise.resolve(nullptr);
          return;
        }
        // Asked again for every key, so a key taken while the first is still being applied
        // resolves no sooner than it; the shield changes nothing for a state it already has.
        auto answer = std::make_shared<JsPromise>(std::move(promise));
        guard->setProtected(true, [answer] { answer->resolve(nullptr); });
      });
      promise("allowScreenCaptureAsync", [state, guard, keyOf](const folly::dynamic &args, JsPromise promise) {
        bool last = false;
        {
          std::lock_guard lock(state->mutex);
          last = state->held.erase(keyOf(args)) > 0 && state->held.empty();
        }
        if (!last || !guard) {
          promise.resolve(nullptr);
          return;
        }
        auto answer = std::make_shared<JsPromise>(std::move(promise));
        guard->setProtected(false, [answer] { answer->resolve(nullptr); });
      });
      auto none = [](const folly::dynamic &, JsPromise promise) { promise.resolve(nullptr); };
      promise("enableAppSwitcherProtectionAsync", none);
      promise("disableAppSwitcherProtectionAsync", none);
      auto granted = [](const folly::dynamic &, JsPromise promise) {
        promise.resolve(folly::dynamic::object("status", "granted")("granted", true)("canAskAgain", true)("expires", "never"));
      };
      promise("getPermissionsAsync", granted);
      promise("requestPermissionsAsync", granted);
    }

    ~ScreenCapture() override {
      std::lock_guard lock(keys->mutex);
      if (!keys->held.empty() && shield) {
        shield->setProtected(false, nullptr);
      }
    }
  };
  return std::make_shared<ScreenCapture>(std::move(shield));
}

} // namespace ngn
