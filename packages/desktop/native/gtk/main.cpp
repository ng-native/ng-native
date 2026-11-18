// ngn-linux: the desktop host on GTK 4. Loads a bundle into one runtime and starts the app, composed
// as every desktop host is (makeHostViews, addCoreModules and addDesktopModules) over Linux's
// HostOs. The app's windows each have a surface (app-windows.h); the app's own surface gets a
// window only when the app renders into it.
//
//   ngn-linux <bundle> [--module <name>] [--title <title>] [--app-id <id>]
//
// NGN_CAPTURE=<file.png> saves the first window's content a second after its first frame, drawn
// in-process (capture.h).
#include "app-windows.h"
#include "capture.h"
#include "gtk-backend.h"
#include "host-sources.h"
#include "pango-text.h"
#include "surface-input.h"
#include "view-widget.h"

#include "ngn/core-modules.h"
#include "ngn/curl-network.h"
#include "ngn/desktop-modules.h"
#include "ngn/dev-server.h"
#include "ngn/file-system.h"
#include "ngn/host-os.h"
#include "ngn/host-views.h"
#include "ngn/launch-settings.h"
#include "ngn/layout-animations.h"
#include "ngn/processes.h"
#include "ngn/runtime.h"

#include <folly/json.h>

#include <adwaita.h>
#include <gtk/gtk.h>
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <memory>
#include <set>

using facebook::react::Float;
using facebook::react::SurfaceId;

extern char **environ;

namespace {

constexpr SurfaceId kAppSurface = 1;

struct Host {
  std::shared_ptr<ngn::gtk::GtkBackend> backend;
  std::shared_ptr<ngn::MountingManager> mounting;
  std::unique_ptr<ngn::InputDispatcher> input;
  std::unique_ptr<ngn::Runtime> runtime;
  std::shared_ptr<ngn::HostState> state;
  std::shared_ptr<ngn::gtk::GtkWindows> windows;
  // The app's own surface and the window it gets once the app renders into it.
  GtkWidget *appWindow{nullptr};
  GtkWidget *appSurface{nullptr};
  bool appWindowShown{false};
  std::set<SurfaceId> surfaces;
  gint64 launched{0};
  bool firstFrame{false};
  bool quit{false};
  guint animationTimer{0};
} gHost;

// The event beat: React Native's RunLoopObserverManager wants a tick as the UI thread is about to
// go idle. GLib calls a source's prepare before each poll, which is that moment.
gboolean beatPrepare(GSource *, gint *timeout) {
  *timeout = -1;
  if (gHost.runtime) {
    gHost.runtime->beat();
  }
  return FALSE;
}
GSourceFuncs gBeatFuncs = {beatPrepare, nullptr, nullptr, nullptr, nullptr, nullptr};

ngn::SurfaceMetrics metricsFor(int width, int height, int scale) {
  return {.size = {static_cast<Float>(width), static_cast<Float>(height)}, .pointScale = static_cast<float>(scale), .fontScale = 1};
}

// The first window's first frame, once drawn: logged, and captured when asked.
void watchFirstFrame(GtkWidget *window, GtkWidget *surface) {
  GdkFrameClock *clock = gtk_widget_get_frame_clock(window);
  if (!clock || gHost.firstFrame) {
    return;
  }
  gHost.firstFrame = true;
  g_signal_connect(clock, "after-paint", G_CALLBACK(+[](GdkFrameClock *, gpointer surface) {
    static bool logged = false;
    if (logged) {
      return;
    }
    logged = true;
    fprintf(stderr, "[ngn] first frame %.0f ms after launch\n", (g_get_monotonic_time() - gHost.launched) / 1000.0);
    if (const char *path = getenv("NGN_CAPTURE"); path && *path) {
      std::string file = path;
      ngn::gtk::runAfter(1, [file, surface] {
        bool saved = ngn::gtk::captureWidget(static_cast<GtkWidget *>(surface), file);
        fprintf(stderr, saved ? "[ngn] captured %s\n" : "[ngn] could not capture %s\n", file.c_str());
      });
    }
  }), surface);
}

// A surface's widget joins the backend and the input dispatcher.
void addSurface(SurfaceId surface, GtkWidget *widget) {
  gHost.backend->addSurface(surface, widget);
  ngn::gtk::attachPointerInput(widget, surface, surface, gHost.input.get());
  gHost.input->addContainer(surface, surface, surface);
  gHost.surfaces.insert(surface);
}

// The app's own surface gets its window once the app renders into it.
void showAppSurfaceIfUsed() {
  const auto *root = gHost.mounting->tree().find(kAppSurface);
  if (gHost.appWindowShown || !root || root->children.empty()) {
    return;
  }
  gHost.appWindowShown = true;
  gtk_window_present(GTK_WINDOW(gHost.appWindow));
}

std::string joined(const std::string &a, const std::string &b) {
  gchar *path = g_build_filename(a.c_str(), b.c_str(), nullptr);
  std::string out = path;
  g_free(path);
  return out;
}

std::string directoryOf(const std::string &path) {
  gchar *dir = g_path_get_dirname(path.c_str());
  std::string out = dir;
  g_free(dir);
  return out;
}

} // namespace

int main(int argc, char *argv[]) {
  gHost.launched = g_get_monotonic_time();
  const ngn::HostOs os = ngn::linuxOs();
  std::vector<std::string> args(argv + 1, argv + argc);
  auto none = [](const std::string &) -> std::optional<std::string> { return std::nullopt; };
  auto launch = ngn::launchSettings(
      {
          .args = args,
          .env = [](const std::string &name) -> std::optional<std::string> {
            const char *value = getenv(name.c_str());
            return value ? std::optional<std::string>(value) : std::nullopt;
          },
          // A packaged app's embedded settings come with packaging.
          .plist = none,
      },
      os);
  if (auto *usage = std::get_if<std::string>(&launch)) {
    fprintf(stderr, "%s\n", usage->c_str());
    return 2;
  }
  static const auto settings = std::get<ngn::LaunchSettings>(launch);
  std::string bundle = settings.bundle;
  std::string appId = settings.appId.empty() ? settings.title : settings.appId;

  gtk_init();
  adw_init();

  gHost.backend = std::make_shared<ngn::gtk::GtkBackend>();
  // The mounting manager, the input dispatcher and the gesture recognisers over the backend, the
  // recognisers' timers on GLib's.
  auto views = ngn::makeHostViews(gHost.backend, gHost.backend, [](double ms, std::function<void()> fn) -> std::function<void()> {
    auto cancelled = std::make_shared<std::atomic<bool>>(false);
    ngn::gtk::runAfter(ms / 1000, [cancelled, fn = std::move(fn)] {
      if (!*cancelled) {
        fn();
      }
    });
    return [cancelled] { *cancelled = true; };
  });
  gHost.mounting = views.mounting;
  gHost.input = std::move(views.input);
  if (settings.logCommits) {
    gHost.mounting->onCommit = [](SurfaceId, double ms) { fprintf(stderr, "[ngn] commit %.1f ms\n", ms); };
  }
  gHost.backend->onMount = [](SurfaceId surfaceId) {
    gHost.input->didMount(surfaceId);
    if (surfaceId == kAppSurface) {
      showAppSurfaceIfUsed();
      if (gHost.appWindowShown) {
        watchFirstFrame(gHost.appWindow, gHost.appSurface);
      }
    } else {
      gHost.windows->didMount(surfaceId);
      if (GtkWidget *window = gHost.windows->window(surfaceId)) {
        watchFirstFrame(window, gHost.windows->surfaceWidget(surfaceId));
      }
    }
  };
  // The cursor the views under the pointer ask for, on each surface: only the one under the
  // pointer shows it.
  gHost.input->onCursor = [](ngn::Cursor cursor) {
    for (SurfaceId surface : gHost.surfaces) {
      GtkWidget *widget = surface == kAppSurface ? gHost.appSurface : gHost.windows->surfaceWidget(surface);
      if (widget) {
        gtk_widget_set_cursor_from_name(widget, ngn::gtk::cursorName(cursor));
      }
    }
  };

  int width = static_cast<int>(ngn::kDefaultWindowWidth), height = static_cast<int>(ngn::kDefaultWindowHeight);
  gHost.appWindow = gtk_window_new();
  gtk_window_set_title(GTK_WINDOW(gHost.appWindow), settings.title.c_str());
  gtk_window_set_default_size(GTK_WINDOW(gHost.appWindow), width, height);
  gHost.appSurface = ngn::gtk::makeSurfaceWidget(kAppSurface, [](int w, int h) {
    if (gHost.runtime) {
      gHost.runtime->updateSurface(kAppSurface, metricsFor(w, h, gtk_widget_get_scale_factor(gHost.appWindow)));
    }
  });
  gtk_window_set_child(GTK_WINDOW(gHost.appWindow), gHost.appSurface);
  addSurface(kAppSurface, gHost.appSurface);
  g_signal_connect(gHost.appWindow, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer) -> gboolean {
    gHost.quit = true;
    return FALSE;
  }), nullptr);
  gtk_widget_realize(gHost.appWindow);

  // The app's folders: a test launch's own, else the XDG ones named for the app.
  std::string appData = settings.test ? settings.test->applicationSupport() : joined(g_get_user_data_dir(), appId);
  std::string caches = settings.test ? settings.test->caches() : joined(g_get_user_cache_dir(), appId);
  g_mkdir_with_parents(caches.c_str(), 0700);
  auto system = ngn::gtk::makeSystem(appId, appData);
  gHost.state = std::make_shared<ngn::HostState>();
  gHost.state->metrics.set({
      .window = {.width = static_cast<double>(width), .height = static_cast<double>(height), .scale = 1, .fontScale = 1},
      .screen = {.width = 1920, .height = 1080, .scale = 1, .fontScale = 1},
  });
  if (!settings.initialUrl.empty()) {
    gHost.state->setInitialUrl(settings.initialUrl);
  }
  auto curl = ngn::makeCurlNetwork();
  ngn::NetworkClients network{curl.http, curl.webSockets};

  static ngn::ProcessesSetup processes;
  for (char **e = environ; e && *e; ++e) {
    std::string entry = *e;
    if (auto eq = entry.find('='); eq != std::string::npos) {
      processes.environment[entry.substr(0, eq)] = entry.substr(eq + 1);
    }
  }
  processes.lookup = {
      .isExecutable = [](const std::string &path) { return access(path.c_str(), X_OK) == 0; },
      .searchPath = os.searchPath,
  };
  if (!settings.capabilitiesJson.empty()) {
    processes.capabilities = ngn::parseCapabilities(folly::parseJson(settings.capabilitiesJson));
  }
  auto document = joined(appData, "Documents");
  g_mkdir_with_parents(document.c_str(), 0700);
  ngn::FileAccess::Folders folders{
      .cache = caches,
      .document = document,
      .appData = appData,
      .temp = settings.test ? settings.test->temp() : g_get_tmp_dir(),
      .home = g_get_home_dir(),
      .desktop = g_get_user_special_dir(G_USER_DIRECTORY_DESKTOP) ? g_get_user_special_dir(G_USER_DIRECTORY_DESKTOP) : "",
      .downloads = g_get_user_special_dir(G_USER_DIRECTORY_DOWNLOAD) ? g_get_user_special_dir(G_USER_DIRECTORY_DOWNLOAD) : "",
  };
  if (auto path = ngn::pathOfUri(bundle)) {
    // An exported bundle on disk: its assets are beside it.
    folders.bundle = directoryOf(*path);
  }
  static auto fileAccess = std::make_shared<ngn::FileAccess>(folders, processes.capabilities.paths);
  ngn::useViewFileAccess(fileAccess);

  // Kept for the process: ReactHost asks it for modules on every reload.
  static auto modules = std::make_shared<ngn::ModuleRegistry>();
  ngn::addCoreModules(
      *modules,
      {.system = system,
       .state = gHost.state,
       .http = network.http,
       .webSockets = network.webSockets,
       .files = fileAccess,
       .reactNativeVersion = NGN_REACT_NATIVE_VERSION,
       .bundle = [bundle] { return bundle; },
       .fakeSystemUI = settings.test && settings.test->fakeSystemUI,
       .gestures = views.gestures,
       .runOnUiThread = [](std::function<void()> task) { gHost.backend->runOnUiThread(std::move(task)); }});

  gHost.windows = std::make_shared<ngn::gtk::GtkWindows>(ngn::gtk::GtkWindows::Hooks{
      .addSurface = addSurface,
      .startSurface = [](SurfaceId surface, int w, int h, int scale) { gHost.runtime->startSurface(surface, "", metricsFor(w, h, scale)); },
      .resizeSurface =
          [](SurfaceId surface, int w, int h, int scale) {
            if (gHost.runtime) {
              gHost.runtime->updateSurface(surface, metricsFor(w, h, scale));
            }
          },
      .stopSurface =
          [](SurfaceId surface) {
            gHost.runtime->stopSurface(surface);
            gHost.input->removeContainer(surface);
            gHost.backend->removeSurface(surface);
            gHost.surfaces.erase(surface);
          },
      .quit = [] { gHost.quit = true; },
  });
  auto windowHost = std::make_shared<ngn::WindowHost>(gHost.windows, system);
  gHost.windows->setHost(windowHost);
  auto menus = std::make_shared<ngn::MenuHost>(
      ngn::gtk::makeNoMenus(),
      ngn::DefaultMenuOptions{.appName = settings.title, .developer = ngn::DevServer::fromBundleUrl(bundle).has_value(), .os = os});
  auto tray = std::make_shared<ngn::TrayHost>(ngn::gtk::makeNoTray());
  auto dock = std::make_shared<ngn::DockHost>(ngn::gtk::makeNoDock());
  // The Expo Updates client, off: this backend has no crypto yet, which a fetched update needs
  // to be checked, so it never fetches one. The bundle runs as given.
  auto updatesConfig = ngn::updatesConfigFrom(settings, os, appData, bundle);
  updatesConfig.url.clear();
  auto updates = std::make_shared<ngn::UpdatesClient>(std::move(updatesConfig), network.http, nullptr);
  // The desktop host's own modules (desktop-modules.h). What this backend has no source for yet
  // is left empty, and its module answers that it is unavailable.
  ngn::addDesktopModules(
      *modules,
      {.os = os,
       .system = system,
       .state = gHost.state,
       .http = network.http,
       .files = fileAccess,
       .appId = appId,
       .appName = settings.title,
       .caches = caches,
       .noPrompts = settings.noPrompts,
       .windows = windowHost,
       .menus = menus,
       .tray = tray,
       .dock = dock,
       .processes = processes,
       .notifications = [](std::shared_ptr<ngn::NotificationEvents>) { return std::shared_ptr<ngn::NotificationCenter>(); },
       .pathMonitor = ngn::gtk::makePathMonitor(),
       .regionCode = [system] {
         auto locale = system->facts().locale;
         auto dash = locale.find('-');
         return dash == std::string::npos ? std::string() : locale.substr(dash + 1);
       },
       .updates = updates,
       .reload = [](const std::string &next, std::function<void(bool)> done) { gHost.runtime->reload(next, std::move(done)); }});

  gHost.runtime = std::make_unique<ngn::Runtime>(
      gHost.mounting,
      std::make_shared<ngn::gtk::PangoTextMeasurer>(),
      ngn::gtk::makeControlMeasurer(),
      modules, network, bundle,
      ngn::DebuggerIdentity{.appId = appId, .deviceName = g_get_host_name(), .os = os.id});
  gHost.runtime->rightToLeft = [system] { return ngn::appRightToLeft(*system); };

  ngn::onLayoutAnimationsRunning([](bool running) {
    gHost.backend->runOnUiThread([running] {
      if (running && gHost.animationTimer == 0) {
        gHost.animationTimer = g_timeout_add(8, [](gpointer) -> gboolean {
          if (gHost.runtime) {
            gHost.runtime->animationTick();
          }
          return G_SOURCE_CONTINUE;
        }, nullptr);
      } else if (!running && gHost.animationTimer != 0) {
        g_source_remove(gHost.animationTimer);
        gHost.animationTimer = 0;
      }
    });
  });

  GSource *beat = g_source_new(&gBeatFuncs, sizeof(GSource));
  g_source_set_priority(beat, G_PRIORITY_LOW);
  g_source_attach(beat, nullptr);

  if (!gHost.runtime->loadBundle()) {
    fprintf(stderr, "ngn-linux: could not load %s\n", bundle.c_str());
    return 1;
  }
  gHost.runtime->startSurface(kAppSurface, settings.module, metricsFor(width, height, gtk_widget_get_scale_factor(gHost.appWindow)));

  while (!gHost.quit) {
    g_main_context_iteration(nullptr, TRUE);
  }
  gHost.runtime->shutdown();
  gHost.runtime.reset();
  return 0;
}
