// One React Native runtime (ReactHost over Hermes) for every window of the app, with its surfaces.
// Toolkit-free: a backend supplies the mounting manager, the text measurer, its modules and the
// event beat, and owns the windows the surfaces mount into.
#pragma once

#include "ngn/desktop-modal.h"
#include "ngn/dev-server.h"
#include "ngn/module-registry.h"
#include "ngn/mounting-manager.h"
#include "ngn/network.h"
#include "ngn/reload-thread.h"
#include "ngn/surface-book.h"
#include "ngn/surface-metrics.h"
#include "ngn/native-controls.h"
#include "ngn/text-measurer.h"

#include <folly/dynamic.h>
#include <react/renderer/graphics/Size.h>

#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace facebook::react {
class ReactHost;
class RunLoopObserverManager;
} // namespace facebook::react

namespace facebook::jsi {
class Runtime;
} // namespace facebook::jsi

namespace ngn {

// The OS's HTTP and WebSocket clients, which Networking, WebSocket and the dev server use.
struct NetworkClients {
  std::shared_ptr<Http> http;
  std::shared_ptr<WebSockets> webSockets;
};

// How the app and the machine are named to the dev server's inspector proxy: React Native
// DevTools and `/json/list` show the app as "<appId> (<deviceName>)".
struct DebuggerIdentity {
  std::string appId{"ngn-desktop"};
  std::string deviceName{"desktop"};
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
      std::string bundle,
      DebuggerIdentity identity = {});
  ~Runtime();
  Runtime(const Runtime &) = delete;
  Runtime &operator=(const Runtime &) = delete;

  // A dev run's (with a dev server): each error React Native's error pipeline sees, fatal or soft,
  // as its exception listeners get it (jsErrorFrom reads it), whether or not LogBox takes it, and
  // each one logged with console.error or caught by ErrorUtils, with `source` "console"
  // (jsErrorFromConsole reads it, red-box-errors.js sends it); and
  // each start of a JavaScript instance, the first and every reload's, Metro's included. Both on
  // the JavaScript thread. Set them before loadBundle.
  std::function<void(const folly::dynamic &error)> onJsError;
  std::function<void()> onInstanceStart;
  // React Native DevTools paused the JavaScript (a breakpoint, `debugger`, a step), and the call
  // that resumes it; then that it resumed. On the inspector's thread. Set them before loadBundle.
  std::function<void(std::function<void()> resume)> onDebuggerPaused;
  std::function<void()> onDebuggerResumed;
  // Whether the app lays out right to left, asked as each JavaScript instance loads (the first
  // and each reload's) and kept for its run, as its I18nManager keeps isRTL. Set before loadBundle.
  std::function<bool()> rightToLeft;

  // Loads the bundle (JavaScript or Hermes bytecode). False if it could not be read or downloaded.
  bool loadBundle();
  // The dev server the bundle came from, or nothing for a bundle on disk.
  const std::optional<DevServer> &devServer() const {
    return devServer_;
  }
  // Tears the runtime down and starts it again on a fresh download of the bundle, with every
  // running surface restarted. Runs off the calling thread; a second call while one runs is
  // dropped. `done` gets whether the bundle loaded, on the UI thread once the reload's thread has
  // ended (or on shutdown's thread, when shutdown joins it), so it may reload again or destroy the
  // runtime: an explicit shutdown() touches nothing of it after such a `done`. One the destructor's
  // shutdown runs must not destroy it again. It gets false, on the calling thread, once shutdown
  // has begun.
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

  // Asks the dev server to open React Native DevTools on this app (its /open-debugger), as the
  // dev menu's Open DevTools does on iOS. Nothing without a dev server.
  void openDebugger();

  // Stops every surface and tears the runtime down, before the process exits.
  void shutdown();

 private:
  void createHost();
  void installErrorListener(facebook::jsi::Runtime &runtime);

  std::shared_ptr<MountingManager> mounting_;
  std::shared_ptr<const TextMeasurer> textMeasurer_;
  std::shared_ptr<const ControlMeasurer> controlMeasurer_;
  std::shared_ptr<ModuleRegistry> modules_;
  NetworkClients clients_;
  std::string bundle_;
  DebuggerIdentity identity_;
  std::optional<DevServer> devServer_;
  std::shared_ptr<facebook::react::RunLoopObserverManager> runLoop_;
  // Guards host_, which a reload holds while it tears the runtime down and loads the bundle. The
  // UI thread never waits on it during a reload: it writes to the book instead.
  std::recursive_mutex mutex_;
  std::atomic<bool> reloading_{false};
  // The reload's thread, which uses this runtime until it ends: one at a time, each joined before
  // the next starts, and closed by shutdown before it tears the runtime down (reload-thread.h).
  ReloadThread reloader_;
  // False once the destructor has run, so a shutdown whose reload `done` destroyed the runtime
  // stops before it touches it again.
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
  std::unique_ptr<facebook::react::ReactHost> host_;
  struct Surface {
    std::string moduleName;
    SurfaceMetrics metrics;
  };
  // Taken before mutex_ when both are, and never held by a reload while it holds mutex_.
  std::mutex surfacesMutex_;
  SurfaceBook<Surface> surfaces_;
  // The direction the running instance's surfaces lay out from.
  SurfaceDirection direction_{[this] { return rightToLeft && rightToLeft(); }};
};

} // namespace ngn
