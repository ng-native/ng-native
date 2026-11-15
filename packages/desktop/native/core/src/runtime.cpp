#include "ngn/runtime.h"

#include "ngn/worklet-host.h"
#include "red-box-errors.h"

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsDefaults.h>
#include <react/http/IHttpClient.h>
#include <react/http/IWebSocketClient.h>
#include <react/logging/DefaultOnJsErrorHandler.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/devsupport/IDevUIDelegate.h>
#include <react/runtime/ReactHost.h>
#include <react/utils/RunLoopObserverManager.h>

#include <glog/logging.h>
#include <jsi/JSIDynamic.h>

#include <set>
#include <thread>

using namespace facebook::react;
namespace jsi = facebook::jsi;

namespace ngn {

namespace {

// HermesInstance installs a microtask queue only for bridgeless, which React Native's scheduler
// needs on its first render. (The same override Basalt makes.)
class FeatureFlags final : public ReactNativeFeatureFlagsDefaults {
 public:
  bool enableBridgelessArchitecture() override {
    return true;
  }
};

// React Native's dev UI as the host has it: the debugger's pause, handed to the runtime's owner.
// The bundle's download progress and loading view are left to the app (DevLoadingView).
class DevUI final : public IDevUIDelegate {
 public:
  explicit DevUI(std::function<void(std::function<void()>)> &paused, std::function<void()> &resumed)
      : paused_(paused), resumed_(resumed) {}
  void showDownloadBundleProgress() override {}
  void hideDownloadBundleProgress() override {}
  void showLoadingView(const std::string &, SharedColor, SharedColor) override {}
  void hideLoadingView() override {}
  void showDebuggerOverlay(std::function<void()> &&resume) override {
    if (paused_) {
      paused_(std::move(resume));
    }
  }
  void hideDebuggerOverlay() override {
    if (resumed_) {
      resumed_();
    }
  }

 private:
  std::function<void(std::function<void()>)> &paused_;
  std::function<void()> &resumed_;
};

LayoutConstraints constraints(const SurfaceMetrics &metrics) {
  return {.minimumSize = metrics.size, .maximumSize = metrics.size};
}

LayoutContext context(const SurfaceMetrics &metrics) {
  LayoutContext context;
  context.pointScaleFactor = metrics.pointScale;
  context.fontSizeMultiplier = metrics.fontScale;
  return context;
}

} // namespace

Runtime::Runtime(
    std::shared_ptr<MountingManager> mounting,
    std::shared_ptr<const TextMeasurer> textMeasurer,
    std::shared_ptr<const ControlMeasurer> controlMeasurer,
    std::shared_ptr<ModuleRegistry> modules,
    NetworkClients clients,
    std::string bundle,
    DebuggerIdentity identity)
    : mounting_(std::move(mounting)),
      textMeasurer_(std::move(textMeasurer)),
      controlMeasurer_(std::move(controlMeasurer)),
      modules_(std::move(modules)),
      clients_(std::move(clients)),
      bundle_(std::move(bundle)),
      identity_(std::move(identity)),
      devServer_(DevServer::fromBundleUrl(bundle_)),
      runLoop_(std::make_shared<RunLoopObserverManager>()),
      // The mounting manager, not this runtime: the reload thread's tasks may run after it is gone.
      reloader_([mounting = mounting_](std::function<void()> task) { mounting->runOnUiThread(std::move(task)); }) {
  // As React Native iOS's surface presenter does after each mount: the UIManager's mount hooks
  // (Reanimated's, which holds its own commits while React's are unmounted, and the observers')
  // learn the views are there. UI thread; skipped while a reload holds the host.
  mounting_->setAfterMountCallback([this](SurfaceId surfaceId) {
    std::unique_lock lock(mutex_, std::try_to_lock);
    if (lock.owns_lock() && host_ && !reloading_) {
      host_->runOnScheduler([surfaceId](Scheduler &scheduler) { scheduler.reportMount(surfaceId); });
    }
  });
  static bool flagsSet = false;
  if (!flagsSet) {
    ReactNativeFeatureFlags::override(std::make_unique<FeatureFlags>());
    flagsSet = true;
  }
  createHost();
}

void Runtime::createHost() {
  auto contextContainer = std::make_shared<ContextContainer>();
  contextContainer->insert(
      HttpClientFactoryKey, clients_.http ? httpClientFactory(clients_.http) : getHttpClientFactory());
  contextContainer->insert(
      WebSocketClientFactoryKey,
      clients_.webSockets ? webSocketClientFactory(clients_.webSockets) : getWebSocketClientFactory());
  installTextMeasurer(*contextContainer, textMeasurer_);
  // Mounts from here on are this instance's (MountingManager::mountedBy).
  mounting_->beginInstance();
  installControlSizes(*contextContainer, mounting_->startControlSizes(controlMeasurer_));
  // react-native-screens' header and tabs descriptors read React Native iOS's image loader from
  // here as they adopt a node, and throw when it is missing. They only keep it, for iOS's own
  // views, so nothing stands in for it.
  contextContainer->insert("RCTImageLoader", std::shared_ptr<void>{});

  ReactInstanceConfig config;
  config.appId = identity_.appId;
  config.deviceName = identity_.deviceName;
  // Dev mode is what makes ReactHost load from the dev server, connect to /message for reload and
  // set up the HMR client; a bundle on disk runs without it.
  config.enableDevMode = devServer_.has_value();
  // The inspector registers the app with the dev server's inspector proxy (its /json/list), which
  // React Native DevTools connects to. Only with a dev server; Release builds have no debugger.
#ifdef NGN_INSPECTOR
  config.enableInspector = devServer_.has_value();
#else
  config.enableInspector = false;
#endif
  if (devServer_) {
    config.devServerHost = devServer_->host;
    config.devServerPort = devServer_->port;
  }

  host_ = std::make_unique<ReactHost>(
      config,
      mounting_,
      runLoop_,
      contextContainer,
      getDefaultOnJsErrorFunc(),
      [](const std::string &message, unsigned int level) { LOG(INFO) << "[js:" << level << "] " << message; },
      std::make_shared<DevUI>(onDebuggerPaused, onDebuggerResumed),
      modules_->providers(),
      nullptr,
      nullptr,
      devServer_ ? ReactInstance::BindingsInstallFunc([this](jsi::Runtime &runtime) { installErrorListener(runtime); })
                 : nullptr);
  // Reanimated reaches the UIManager through here as it installs (worklet-host.h).
  auto *host = host_.get();
  workletHost().runOnScheduler.set([host](std::function<void(Scheduler &)> task) { host->runOnScheduler(std::move(task)); });
}

Runtime::~Runtime() {
  shutdown();
  *alive_ = false;
}

// Before the bundle runs, so the listener is the pipeline's first: LogBox, which an Angular app
// never draws, prevents the default handling of the errors it takes, but every listener still
// hears them.
void Runtime::installErrorListener(jsi::Runtime &runtime) {
  if (onInstanceStart) {
    onInstanceStart();
  }
  auto report = [this](jsi::Runtime &rt, const jsi::Value &error, bool console) {
    if (!error.isObject() || !onJsError) {
      return;
    }
    try {
      auto data = jsi::dynamicFromValue(rt, error);
      if (console) {
        data["source"] = "console";
      }
      onJsError(data);
    } catch (const std::exception &e) {
      LOG(WARNING) << "ngn: an error could not be read for the red box: " << e.what();
    }
  };
  // Errors the pipeline does not see once the runtime is ready: console.error's and ErrorUtils'.
  try {
    auto install = runtime.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(kRedBoxErrors), "ngn-red-box-errors.js");
    install.asObject(runtime).asFunction(runtime).call(
        runtime,
        jsi::Function::createFromHostFunction(
            runtime,
            jsi::PropNameID::forAscii(runtime, "ngnReportError"),
            1,
            [report](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
              if (count > 0) {
                report(rt, args[0], true);
              }
              return jsi::Value::undefined();
            }));
  } catch (const std::exception &e) {
    LOG(WARNING) << "ngn: the red box's error hook did not install: " << e.what();
  }
  auto global = runtime.global();
  auto registerListener = global.getProperty(runtime, "RN$registerExceptionListener");
  if (!registerListener.isObject() || !registerListener.asObject(runtime).isFunction(runtime)) {
    return;
  }
  auto listener = jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "ngnRedBox"),
      1,
      [report](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
        if (count > 0) {
          report(rt, args[0], false);
        }
        return jsi::Value::undefined();
      });
  registerListener.asObject(runtime).asFunction(runtime).call(runtime, std::move(listener));
}

void Runtime::openDebugger() {
  std::lock_guard lock(mutex_);
  if (host_ && devServer_) {
    host_->openDebugger();
  }
}

bool Runtime::loadBundle() {
  std::lock_guard lock(mutex_);
  if (!host_) {
    return false;
  }
  // With dev mode on, ReactHost downloads the source path through the dev server helper, which
  // takes the bundle URL as it is.
  return devServer_ ? host_->loadScript("", bundle_) : host_->loadScript(bundle_, bundle_);
}

void Runtime::startSurface(SurfaceId surfaceId, const std::string &moduleName, const SurfaceMetrics &metrics) {
  std::lock_guard book(surfacesMutex_);
  if (!surfaces_.start(surfaceId, {moduleName, metrics})) {
    return;
  }
  std::lock_guard lock(mutex_);
  if (host_) {
    host_->startSurface(surfaceId, moduleName, folly::dynamic::object(), constraints(metrics), context(metrics));
  }
}

void Runtime::stopSurface(SurfaceId surfaceId) {
  std::lock_guard book(surfacesMutex_);
  if (!surfaces_.stop(surfaceId)) {
    return;
  }
  std::lock_guard lock(mutex_);
  if (host_) {
    host_->stopSurface(surfaceId);
  }
}

void Runtime::updateSurface(SurfaceId surfaceId, const SurfaceMetrics &metrics) {
  std::lock_guard book(surfacesMutex_);
  // During a reload the restarted surface takes the metrics recorded here.
  if (!surfaces_.update(surfaceId, [&](Surface &surface) { surface.metrics = metrics; })) {
    return;
  }
  std::lock_guard lock(mutex_);
  if (host_) {
    host_->setSurfaceConstraints(surfaceId, constraints(metrics), context(metrics));
  }
}

std::optional<SheetNode> Runtime::sheetNode(SurfaceId surfaceId, Tag tag) {
  std::unique_lock lock(mutex_, std::try_to_lock);
  std::optional<SheetNode> found;
  if (!lock.owns_lock() || !host_ || reloading_) {
    return found;
  }
  host_->runOnScheduler([&](Scheduler &scheduler) {
    scheduler.getUIManager()->getShadowTreeRegistry().visit(surfaceId, [&](const ShadowTree &tree) {
      std::function<const ShadowNode *(const ShadowNode &)> find = [&](const ShadowNode &node) -> const ShadowNode * {
        if (node.getTag() == tag) {
          return &node;
        }
        for (const auto &child : node.getChildren()) {
          if (const auto *hit = find(*child)) {
            return hit;
          }
        }
        return nullptr;
      };
      auto root = tree.getCurrentRevision().rootShadowNode;
      if (const auto *node = root ? find(*root) : nullptr) {
        found = ngn::sheetNode(*node);
      }
    });
  });
  return found;
}

void Runtime::animationTick() {
  // A frame skipped while a reload holds the host is no loss; reading host_ without the lock is.
  std::unique_lock lock(mutex_, std::try_to_lock);
  if (lock.owns_lock() && host_ && !reloading_) {
    host_->runOnScheduler([](Scheduler &scheduler) { scheduler.animationTick(); });
  }
}

void Runtime::beat() {
  if (!reloading_) {
    runLoop_->onRender();
  }
}

void Runtime::reload(std::function<void(bool)> done) {
  {
    std::lock_guard book(surfacesMutex_);
    if (!surfaces_.beginReload()) {
      return;
    }
    reloading_ = true;
  }
  // Tearing down waits for the JS thread and the download blocks, so neither runs on the UI
  // thread, whose queue the mounting of the stopped surfaces still needs. A reload asked for while
  // the last one's thread is still ending waits its turn and starts from the UI queue. Once
  // shutdown has begun, no run starts: the bundle never loads, and `done` gets false.
  auto loaded = std::make_shared<bool>(false);
  reloader_.start([this, loaded] {
    bool restarted = false;
    {
      std::lock_guard lock(mutex_);
      if (host_) {
        host_->stopAllSurfaces();
        workletHost().runOnScheduler.set(nullptr);
        host_.reset();
        createHost();
        *loaded = devServer_ ? host_->loadScript("", bundle_) : host_->loadScript(bundle_, bundle_);
        restarted = true;
      }
    }
    // Brings the new runtime to the surfaces the book has, which the UI thread may change
    // meanwhile, until they match and the reload ends. mutex_ is never held while the book's lock
    // is taken, which the UI thread takes first.
    std::set<SurfaceId> started;
    while (true) {
      std::optional<SurfaceBook<Surface>::Step> step;
      {
        std::lock_guard book(surfacesMutex_);
        if (!restarted) {
          for (const auto &[id, surface] : surfaces_.surfaces()) {
            started.insert(id);
          }
        }
        step = surfaces_.settle(started);
        if (!step) {
          reloading_ = false;
          break;
        }
      }
      std::lock_guard lock(mutex_);
      for (const auto &[surfaceId, surface] : step->start) {
        host_->startSurface(
            surfaceId, surface.moduleName, folly::dynamic::object(), constraints(surface.metrics), context(surface.metrics));
        started.insert(surfaceId);
      }
      // A surface resized after the reload started it takes its size now.
      for (const auto &[surfaceId, surface] : step->update) {
        host_->setSurfaceConstraints(surfaceId, constraints(surface.metrics), context(surface.metrics));
      }
      for (auto surfaceId : step->stop) {
        host_->stopSurface(surfaceId);
        started.erase(surfaceId);
      }
    }
  }, [done = std::move(done), loaded](bool ran) {
    // On the UI queue once the run's thread has been joined (reload-thread.h), so `done` may reload
    // again or destroy this runtime; it touches neither itself.
    if (done) {
      done(ran && *loaded);
    }
  });
}

void Runtime::reload(std::string bundle, std::function<void(bool)> done) {
  if (devServer_) {
    if (done) {
      done(false);
    }
    return;
  }
  {
    std::lock_guard lock(mutex_);
    bundle_ = std::move(bundle);
  }
  reload(std::move(done));
}

void Runtime::shutdown() {
  // A reload still running holds this runtime: none starts from now (one waiting its turn is
  // dropped), and the one running is joined, its `done` run, before the teardown.
  auto alive = alive_;
  // The mounting manager, not this runtime: a `done` that close runs may destroy this runtime.
  reloader_.close([mounting = mounting_] { mounting->serviceUiThread(); });
  // A reload's `done` that close ran may have destroyed this runtime.
  if (!*alive) {
    return;
  }
  std::lock_guard lock(mutex_);
  if (host_) {
    workletHost().runOnScheduler.set(nullptr);
    host_->stopAllSurfaces();
    host_.reset();
  }
}

} // namespace ngn
