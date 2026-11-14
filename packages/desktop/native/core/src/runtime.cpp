#include "ngn/runtime.h"

#include "ngn/worklet-host.h"

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsDefaults.h>
#include <react/http/IHttpClient.h>
#include <react/http/IWebSocketClient.h>
#include <react/logging/DefaultOnJsErrorHandler.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/runtime/ReactHost.h>
#include <react/utils/RunLoopObserverManager.h>

#include <glog/logging.h>

#include <set>
#include <thread>

using namespace facebook::react;

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
    std::string bundle)
    : mounting_(std::move(mounting)),
      textMeasurer_(std::move(textMeasurer)),
      controlMeasurer_(std::move(controlMeasurer)),
      modules_(std::move(modules)),
      clients_(std::move(clients)),
      bundle_(std::move(bundle)),
      devServer_(DevServer::fromBundleUrl(bundle_)),
      runLoop_(std::make_shared<RunLoopObserverManager>()) {
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
  installControlMeasurer(*contextContainer, controlMeasurer_);
  // react-native-screens' header and tabs descriptors read React Native iOS's image loader from
  // here as they adopt a node, and throw when it is missing. They only keep it, for iOS's own
  // views, so nothing stands in for it.
  contextContainer->insert("RCTImageLoader", std::shared_ptr<void>{});

  ReactInstanceConfig config;
  config.appId = "ngn-desktop";
  config.deviceName = "desktop";
  // Dev mode is what makes ReactHost load from the dev server, connect to /message for reload and
  // set up the HMR client; a bundle on disk runs without it.
  config.enableDevMode = devServer_.has_value();
  config.enableInspector = false;
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
      nullptr,
      modules_->providers());
  // Reanimated reaches the UIManager through here as it installs (worklet-host.h).
  auto *host = host_.get();
  workletHost().runOnScheduler = [host](std::function<void(Scheduler &)> task) { host->runOnScheduler(std::move(task)); };
}

Runtime::~Runtime() {
  shutdown();
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
  // thread, whose queue the mounting of the stopped surfaces still needs.
  std::thread([this, done = std::move(done)] {
    bool loaded = false;
    bool restarted = false;
    {
      std::lock_guard lock(mutex_);
      if (host_) {
        host_->stopAllSurfaces();
        workletHost().runOnScheduler = nullptr;
        host_.reset();
        createHost();
        loaded = devServer_ ? host_->loadScript("", bundle_) : host_->loadScript(bundle_, bundle_);
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
      for (auto surfaceId : step->stop) {
        host_->stopSurface(surfaceId);
        started.erase(surfaceId);
      }
    }
    if (done) {
      done(loaded);
    }
  }).detach();
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
  std::lock_guard lock(mutex_);
  if (host_) {
    workletHost().runOnScheduler = nullptr;
    host_->stopAllSurfaces();
    host_.reset();
  }
}

} // namespace ngn
