// One React Native runtime (ReactHost over Hermes) for every window of the app, with its surfaces.
// Toolkit-free: a backend supplies the mounting manager, the text measurer, its modules and the
// event beat, and owns the windows the surfaces mount into.
#pragma once

#include "ngn/desktop-modal.h"
#include "ngn/dev-server.h"
#include "ngn/module-registry.h"
#include "ngn/mounting-manager.h"
#include "ngn/network.h"
#include "ngn/surface-book.h"
#include "ngn/native-controls.h"
#include "ngn/text-measurer.h"

#include <react/renderer/graphics/Size.h>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

namespace facebook::react {
class ReactHost;
class RunLoopObserverManager;
} // namespace facebook::react

namespace ngn {

struct SurfaceMetrics {
  facebook::react::Size size{};
  // Device pixels per point.
  float pointScale{2};
  // The text size multiplier.
  float fontScale{1};
};

// The OS's HTTP and WebSocket clients, which Networking, WebSocket and the dev server use.
struct NetworkClients {
  std::shared_ptr<Http> http;
  std::shared_ptr<WebSockets> webSockets;
};

class Runtime {
 public:
  // `bundle` is a path on disk or a Metro bundle URL. A URL turns dev mode on: the bundle loads
  // from Metro, which can then reload the app (/message) and Fast Refresh it (the HMR client).
  Runtime(
      std::shared_ptr<MountingManager> mounting,
      std::shared_ptr<const TextMeasurer> textMeasurer,
      std::shared_ptr<const ControlMeasurer> controlMeasurer,
      std::shared_ptr<ModuleRegistry> modules,
      NetworkClients clients,
      std::string bundle);
  ~Runtime();
  Runtime(const Runtime &) = delete;
  Runtime &operator=(const Runtime &) = delete;

  // Loads the bundle (JavaScript or Hermes bytecode). False if it could not be read or downloaded.
  bool loadBundle();
  // The dev server the bundle came from, or nothing for a bundle on disk.
  const std::optional<DevServer> &devServer() const {
    return devServer_;
  }
  // Tears the runtime down and starts it again on a fresh download of the bundle, with every
  // running surface restarted. Runs off the calling thread; a second call while one runs is
  // dropped. `done` gets whether the bundle loaded, on the reload's thread.
  void reload(std::function<void(bool)> done = nullptr);
  // The same, on another bundle on disk: an update's (updates.h). Ignored for a dev server's bundle.
  void reload(std::string bundle, std::function<void(bool)> done);

  // An empty `moduleName` starts a surface that runs nothing: one the app renders into itself, such
  // as a second window's.
  void startSurface(SurfaceId surfaceId, const std::string &moduleName, const SurfaceMetrics &metrics);
  void stopSurface(SurfaceId surfaceId);
  void updateSurface(SurfaceId surfaceId, const SurfaceMetrics &metrics);

  // The view `tag` on `surfaceId` and those under it, as the shadow tree last laid them out: what
  // a sheet sizes itself by (desktop-modal.h). Nothing when it is not there. Any thread.
  std::optional<SheetNode> sheetNode(SurfaceId surfaceId, Tag tag);

  // The event beat: the backend calls it each time its UI thread's run loop is about to wait.
  void beat();
  // A frame of the running layout animations (layout-animations.h). UI thread.
  void animationTick();

  // Stops every surface and tears the runtime down, before the process exits.
  void shutdown();

 private:
  void createHost();

  std::shared_ptr<MountingManager> mounting_;
  std::shared_ptr<const TextMeasurer> textMeasurer_;
  std::shared_ptr<const ControlMeasurer> controlMeasurer_;
  std::shared_ptr<ModuleRegistry> modules_;
  NetworkClients clients_;
  std::string bundle_;
  std::optional<DevServer> devServer_;
  std::shared_ptr<facebook::react::RunLoopObserverManager> runLoop_;
  // Guards host_, which a reload holds while it tears the runtime down and loads the bundle. The
  // UI thread never waits on it during a reload: it writes to the book instead.
  std::recursive_mutex mutex_;
  std::atomic<bool> reloading_{false};
  std::unique_ptr<facebook::react::ReactHost> host_;
  struct Surface {
    std::string moduleName;
    SurfaceMetrics metrics;
  };
  // Taken before mutex_ when both are, and never held by a reload while it holds mutex_.
  std::mutex surfacesMutex_;
  SurfaceBook<Surface> surfaces_;
};

} // namespace ngn
