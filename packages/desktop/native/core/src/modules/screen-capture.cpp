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
        bool first = false;
        {
          std::lock_guard lock(state->mutex);
          first = state->held.empty();
          state->held.insert(keyOf(args));
        }
        if (first && guard) {
          guard->setProtected(true);
        }
        promise.resolve(nullptr);
      });
      promise("allowScreenCaptureAsync", [state, guard, keyOf](const folly::dynamic &args, JsPromise promise) {
        bool last = false;
        {
          std::lock_guard lock(state->mutex);
          last = state->held.erase(keyOf(args)) > 0 && state->held.empty();
        }
        if (last && guard) {
          guard->setProtected(false);
        }
        promise.resolve(nullptr);
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
        shield->setProtected(false);
      }
    }
  };
  return std::make_shared<ScreenCapture>(std::move(shield));
}

} // namespace ngn
