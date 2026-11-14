#include "ngn/runtime.h"

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsDefaults.h>
#include <react/http/IHttpClient.h>
#include <react/http/IWebSocketClient.h>
#include <react/logging/DefaultOnJsErrorHandler.h>
#include <react/runtime/ReactHost.h>
#include <react/utils/RunLoopObserverManager.h>

#include <glog/logging.h>

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
    std::shared_ptr<ModuleRegistry> modules)
    : mounting_(std::move(mounting)),
      modules_(std::move(modules)),
      runLoop_(std::make_shared<RunLoopObserverManager>()) {
  static bool flagsSet = false;
  if (!flagsSet) {
    ReactNativeFeatureFlags::override(std::make_unique<FeatureFlags>());
    flagsSet = true;
  }

  auto contextContainer = std::make_shared<ContextContainer>();
  contextContainer->insert(HttpClientFactoryKey, getHttpClientFactory());
  contextContainer->insert(WebSocketClientFactoryKey, getWebSocketClientFactory());
  installTextMeasurer(*contextContainer, std::move(textMeasurer));

  ReactInstanceConfig config;
  config.appId = "ngn-desktop";
  config.deviceName = "desktop";
  config.enableDevMode = false;
  config.enableInspector = false;

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

bool Runtime::loadBundle(const std::string &path) {
  return host_ && host_->loadScript(path, path);
}

void Runtime::startSurface(SurfaceId surfaceId, const std::string &moduleName, const SurfaceMetrics &metrics) {
  host_->startSurface(surfaceId, moduleName, folly::dynamic::object(), constraints(metrics), context(metrics));
}

void Runtime::updateSurface(SurfaceId surfaceId, const SurfaceMetrics &metrics) {
  if (host_) {
    host_->setSurfaceConstraints(surfaceId, constraints(metrics), context(metrics));
  }
}

void Runtime::beat() {
  runLoop_->onRender();
}

void Runtime::shutdown() {
  if (host_) {
    host_->stopAllSurfaces();
    host_.reset();
  }
}

} // namespace ngn
