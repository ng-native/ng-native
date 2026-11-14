// react-native-worklets' native part on the desktop host, in place of its iOS WorkletsModule.mm:
// the WorkletsModule TurboModule, a UI scheduler on the backend's UI thread, and
// requestAnimationFrame from the host's animation frames (ngn/worklet-host.h). The library's own
// shared C++ does the rest: the UI runtime (a second Hermes), serialization and the run loops.
// Compiled into the host only with the library (cmake/libraries/react-native-worklets.cmake).
#include "ngn/library-glue.h"
#include "ngn/worklet-host.h"

#include <ReactCommon/TurboModule.h>
#include <worklets/NativeModules/WorkletsModuleProxyInitializer.h>
#include <worklets/Tools/JSScheduler.h>
#include <worklets/Tools/PlatformLogger.h>
#include <worklets/Tools/RNRuntimeStatus.h>
#include <worklets/Tools/UIScheduler.h>
#include <worklets/WorkletRuntime/RuntimeBindings.h>

#include <glog/logging.h>

#include "worklets-idle-frames.h"

#include <cstdio>
#include <stdexcept>
#include <thread>

using namespace facebook;
using namespace facebook::react;

namespace worklets {

void PlatformLogger::log(const char *str) {
  LOG(INFO) << "[worklets] " << str;
}
void PlatformLogger::log(const std::string &str) {
  log(str.c_str());
}
void PlatformLogger::log(const double d) {
  log(std::to_string(d));
}
void PlatformLogger::log(const int i) {
  log(std::to_string(i));
}
void PlatformLogger::log(const bool b) {
  log(b ? "true" : "false");
}

} // namespace worklets

namespace ngn {

namespace {

// iOS's IOSUIScheduler: a job from the UI thread runs at once, one from elsewhere waits in the
// queue, which one task on the UI thread drains.
class DesktopUIScheduler final : public worklets::UIScheduler,
                                 public std::enable_shared_from_this<DesktopUIScheduler> {
 public:
  void scheduleOnUI(std::function<void()> job) override {
    if (isOnUIThread()) {
      job();
      wake();
      return;
    }
    UIScheduler::scheduleOnUI(std::move(job));
    if (!scheduledOnUI_) {
      workletHost().runOnUiThread([weak = weak_from_this()] {
        if (auto self = weak.lock()) {
          self->triggerUI();
        }
      });
    }
  }

 void triggerUI() override {
    UIScheduler::triggerUI();
    wake();
  }

 protected:
  static void wake() {
    if (auto wake = workletHost().wakeUiFrames) {
      wake();
    }
  }

  bool queryIsOnUIThread() const override {
    return workletHost().isUiThread();
  }
};

class WorkletsModule final : public TurboModule {
 public:
  explicit WorkletsModule(const std::shared_ptr<CallInvoker> &jsInvoker)
      : TurboModule("WorkletsModule", jsInvoker), jsInvoker_(jsInvoker) {
    methodMap_["installTurboModule"] = MethodMetadata{1, &WorkletsModule::installTurboModule};
    methodMap_["start"] = MethodMetadata{0, &WorkletsModule::start};
    // Bundle mode needs the bundle served for the worklet runtimes too, which the host's dev
    // server path does not do yet.
    methodMap_["prepareBundleMode"] = MethodMetadata{0, [](jsi::Runtime &, TurboModule &, const jsi::Value *, size_t) {
      return jsi::Value(false);
    }};
    methodMap_["toggleSlowAnimationsOnUIRuntime"] =
        MethodMetadata{0, [](jsi::Runtime &rt, TurboModule &, const jsi::Value *, size_t) -> jsi::Value {
          throw jsi::JSError(rt, "[Worklets] toggleSlowAnimationsOnUIRuntime is not supported on macOS.");
        }};
  }

  ~WorkletsModule() override {
    workletHost().wakeUiFrames = nullptr;
    status_->setDead();
    if (initializer_) {
      initializer_->invalidate();
    }
    proxy_.reset();
    // A frame asked for by the runtime going away must not reach it.
    workletHost().frames.clear();
  }

 private:
  static jsi::Value installTurboModule(jsi::Runtime &rt, TurboModule &turboModule, const jsi::Value *args, size_t count) {
    auto &self = static_cast<WorkletsModule &>(turboModule);
    bool bundleMode = count > 0 && args[0].isBool() && args[0].getBool();
    if (bundleMode) {
      throw jsi::JSError(rt, "[Worklets] Bundle mode is not supported on macOS yet.");
    }
    if (self.proxy_) {
      return jsi::Value(true);
    }
    // The JavaScript thread is the one installing.
    auto jsThread = std::this_thread::get_id();
    auto jsScheduler = std::make_shared<worklets::JSScheduler>(
        rt, self.jsInvoker_, [jsThread] { return std::this_thread::get_id() == jsThread; });
    auto bindings = std::make_shared<worklets::RuntimeBindings>(worklets::RuntimeBindings{
        .requestAnimationFrame =
            [](std::function<void(const double)> &&callback) { workletHost().frames.request(std::move(callback)); },
        .nativeLoggingHook =
            [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
          if (count > 0) {
            LOG(INFO) << "[js worklet] " << args[0].toString(rt).utf8(rt);
          }
          return jsi::Value::undefined();
        },
        .networkingBackend = nullptr,
    });
    self.initializer_ = std::make_shared<worklets::WorkletsModuleProxyInitializer>(
        jsScheduler, std::make_shared<DesktopUIScheduler>(), bindings, self.status_);
    // iOS prepares the proxy (the UI runtime) on a background queue while the bundle loads; here
    // it is made as the library installs, which is the first time anything asks for it.
    self.initializer_->prepareProxy();
    self.proxy_ = self.initializer_->finalize(rt, false, [] { return worklets::BundleModeConfig{.enabled = false}; });
    return jsi::Value(true);
  }

  static jsi::Value start(jsi::Runtime &rt, TurboModule &turboModule, const jsi::Value *, size_t) {
    auto &self = static_cast<WorkletsModule &>(turboModule);
    if (!self.proxy_) {
      throw jsi::JSError(rt, "[Worklets] start before installTurboModule");
    }
    self.proxy_->start();
    // The UI runtime's frame loop asks for a frame at the end of every frame; parked while it has
    // no work, a still app takes none (worklets-idle-frames.js).
    self.proxy_->getUIWorkletRuntime()->schedule([](jsi::Runtime &ui) {
      ui.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(kWorkletsIdleFrames), "ngn-worklets-idle-frames.js");
    });
    std::weak_ptr<worklets::WorkletRuntime> ui = self.proxy_->getUIWorkletRuntime();
    workletHost().wakeUiFrames = [ui] {
      auto runtime = ui.lock();
      if (!runtime) {
        return;
      }
      runtime->runSync([](jsi::Runtime &rt) {
        auto wake = rt.global().getProperty(rt, "__ngnWakeFrames");
        if (wake.isObject() && wake.asObject(rt).isFunction(rt)) {
          wake.asObject(rt).asFunction(rt).call(rt);
        }
      });
    };
    return jsi::Value(true);
  }

  std::shared_ptr<CallInvoker> jsInvoker_;
  std::shared_ptr<worklets::RNRuntimeStatus> status_ = std::make_shared<worklets::RNRuntimeStatus>();
  std::shared_ptr<worklets::WorkletsModuleProxyInitializer> initializer_;
  std::shared_ptr<worklets::WorkletsModuleProxy> proxy_;
};

} // namespace

void installGlue_rnworklets() {
  libraryGlue().modules["WorkletsModule"] = [](const std::shared_ptr<CallInvoker> &jsInvoker) {
    return std::make_shared<WorkletsModule>(jsInvoker);
  };
}

} // namespace ngn
