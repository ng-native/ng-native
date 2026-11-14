#include "ngn/runtime.h"

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsDefaults.h>
#include <react/http/IHttpClient.h>
#include <react/http/IWebSocketClient.h>
#include <react/logging/DefaultOnJsErrorHandler.h>
#include <react/runtime/ReactHost.h>
#include <react/utils/RunLoopObserverManager.h>

#include <glog/logging.h>

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
    std::shared_ptr<ModuleRegistry> modules,
    NetworkClients clients,
    std::string bundle)
    : mounting_(std::move(mounting)),
      textMeasurer_(std::move(textMeasurer)),
      modules_(std::move(modules)),
      clients_(std::move(clients)),
      bundle_(std::move(bundle)),
      devServer_(DevServer::fromBundleUrl(bundle_)),
      runLoop_(std::make_shared<RunLoopObserverManager>()) {
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
  std::lock_guard lock(mutex_);
  surfaces_[surfaceId] = {moduleName, metrics};
  host_->startSurface(surfaceId, moduleName, folly::dynamic::object(), constraints(metrics), context(metrics));
}

void Runtime::updateSurface(SurfaceId surfaceId, const SurfaceMetrics &metrics) {
  std::unique_lock lock(mutex_, std::try_to_lock);
  if (auto it = surfaces_.find(surfaceId); it != surfaces_.end()) {
    it->second.metrics = metrics;
  }
  // During a reload the restarted surface takes the metrics recorded above.
  if (lock.owns_lock() && host_ && !reloading_) {
    host_->setSurfaceConstraints(surfaceId, constraints(metrics), context(metrics));
  }
}

void Runtime::animationTick() {
  if (host_ && !reloading_) {
    host_->runOnScheduler([](Scheduler &scheduler) { scheduler.animationTick(); });
  }
}

void Runtime::beat() {
  if (!reloading_) {
    runLoop_->onRender();
  }
}

void Runtime::reload(std::function<void(bool)> done) {
  if (reloading_.exchange(true)) {
    return;
  }
  // Tearing down waits for the JS thread and the download blocks, so neither runs on the UI
  // thread, whose queue the mounting of the stopped surfaces still needs.
  std::thread([this, done = std::move(done)] {
    bool loaded = false;
    {
      std::lock_guard lock(mutex_);
      if (host_) {
        host_->stopAllSurfaces();
        host_.reset();
        createHost();
        loaded = devServer_ ? host_->loadScript("", bundle_) : host_->loadScript(bundle_, bundle_);
        for (const auto &[surfaceId, surface] : surfaces_) {
          host_->startSurface(
              surfaceId,
              surface.moduleName,
              folly::dynamic::object(),
              constraints(surface.metrics),
              context(surface.metrics));
        }
      }
    }
    reloading_ = false;
    if (done) {
      done(loaded);
    }
  }).detach();
}

void Runtime::shutdown() {
  std::lock_guard lock(mutex_);
  if (host_) {
    host_->stopAllSurfaces();
    host_.reset();
  }
}

} // namespace ngn
