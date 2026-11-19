// ngn-linux: the desktop host on GTK 4. Loads a bundle into one runtime and starts the app, composed
// as every desktop host is (makeHostViews, addCoreModules and addDesktopModules) over Linux's
// HostOs. The app's windows each have a surface (app-windows.h); the app's own surface gets a
// window only when the app renders into it.
//
//   ngn-linux <bundle> [--module <name>] [--title <title>] [--app-id <id>]
//   ngn-linux             (a packaged app: what the metadata.json beside it names; argv and env
//                          are ignored)
//
// NGN_CAPTURE=<file.png> saves the first window's content a second after its first frame, drawn
// in-process (capture.h).
#include "app-windows.h"
#include "capture.h"
#include "gtk-backend.h"
#include "host-sources.h"
#include "image-view.h"
#include "input-replay.h"
#include "pango-text.h"
#include "scroll-view.h"
#include "surface-input.h"
#include "view-widget.h"

#include "ngn/core-modules.h"
#include "ngn/crash-report.h"
#include "ngn/curl-network.h"
#include "ngn/desktop-modules.h"
#include "ngn/dev-server.h"
#include "ngn/file-system.h"
#include "ngn/host-os.h"
#include "ngn/host-state.h"
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
#include <map>
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
  // What each surface last reported of its size and its chrome's insets.
  std::map<SurfaceId, ngn::ContainerInsets> reported;
  GtkApplication *application{nullptr};
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
  return {.size = {static_cast<Float>(width), static_cast<Float>(height)}, .pointScale = static_cast<float>(scale), .fontScale = ngn::gtk::desktopFontScale()};
}

GtkWidget *surfaceWidgetOf(SurfaceId surface) {
  return surface == kAppSurface ? gHost.appSurface : gHost.windows ? gHost.windows->surfaceWidget(surface) : nullptr;
}

// The text scaling changed: every surface lays out again at it, and Dimensions reports it.
void followFontScale() {
  float fontScale = ngn::gtk::desktopFontScale();
  auto metrics = gHost.state->metrics.get();
  metrics.window.fontScale = metrics.screen.fontScale = fontScale;
  gHost.state->metrics.set(metrics);
  for (SurfaceId surface : gHost.surfaces) {
    GtkWidget *widget = surfaceWidgetOf(surface);
    if (widget && gHost.runtime) {
      gHost.runtime->updateSurface(
          surface, metricsFor(gtk_widget_get_width(widget), gtk_widget_get_height(widget), gtk_widget_get_scale_factor(widget)));
    }
  }
}

// What Dimensions reports: the app window's content size and scale, and its monitor's size (the
// first monitor's before the window is on one; the window's own size with no monitor at all).
ngn::WindowMetrics windowMetrics(int width, int height) {
  double scale = gtk_widget_get_scale_factor(gHost.appWindow);
  double screenWidth = width, screenHeight = height;
  GdkDisplay *display = gtk_widget_get_display(gHost.appWindow);
  GdkSurface *surface = gtk_native_get_surface(GTK_NATIVE(gHost.appWindow));
  GdkMonitor *monitor = surface ? gdk_display_get_monitor_at_surface(display, surface) : nullptr;
  GListModel *monitors = gdk_display_get_monitors(display);
  GdkMonitor *first = !monitor && g_list_model_get_n_items(monitors) > 0 ? GDK_MONITOR(g_list_model_get_item(monitors, 0)) : nullptr;
  if (GdkMonitor *m = monitor ? monitor : first) {
    GdkRectangle geometry;
    gdk_monitor_get_geometry(m, &geometry);
    screenWidth = geometry.width;
    screenHeight = geometry.height;
  }
  if (first) {
    g_object_unref(first);
  }
  return {
      .window = {.width = static_cast<double>(width), .height = static_cast<double>(height), .scale = scale, .fontScale = ngn::gtk::desktopFontScale()},
      .screen = {.width = screenWidth, .height = screenHeight, .scale = scale, .fontScale = ngn::gtk::desktopFontScale()},
  };
}

// A dev or test run's input script (NGN_INPUT_SCRIPT), played into the first window once it shows.
std::string gInputScript;

void playInputScript(GtkWidget *window) {
  gchar *text = nullptr;
  if (!g_file_get_contents(gInputScript.c_str(), &text, nullptr, nullptr)) {
    fprintf(stderr, "[ngn] input script %s: cannot be read\n", gInputScript.c_str());
    return;
  }
  auto script = ngn::parseInputScript(text);
  g_free(text);
  ngn::gtk::replayInputScript(window, std::move(script));
}

// The first window's first frame, once drawn: logged, captured when asked, and given the run's
// input script.
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
    if (!gInputScript.empty()) {
      playInputScript(GTK_WIDGET(gtk_widget_get_root(static_cast<GtkWidget *>(surface))));
    }
    if (const char *path = getenv("NGN_CAPTURE"); path && *path) {
      std::string file = path;
      ngn::gtk::runAfter(1, [file, surface] {
        bool saved = ngn::gtk::captureWidget(static_cast<GtkWidget *>(surface), file);
        fprintf(stderr, saved ? "[ngn] captured %s\n" : "[ngn] could not capture %s\n", file.c_str());
      });
    }
  }), surface);
}

// A surface's size and the safe area its window's chrome leaves it (chromeInsets), each time
// either changes: as it resizes, and as the header bar or the window controls move over content
// that runs under them.
void reportContainer(SurfaceId surface) {
  GtkWidget *widget = surfaceWidgetOf(surface);
  if (!widget || !gHost.mounting) {
    return;
  }
  auto insets = ngn::gtk::chromeInsets(widget);
  if (auto it = gHost.reported.find(surface); it != gHost.reported.end() && it->second == insets) {
    return;
  }
  gHost.reported[surface] = insets;
  gHost.backend->modals().settle();
  gHost.mounting->setContainerInsets(surface, insets);
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

// A second launch or the bus asks for the app: the window the app draws into without AppWindows,
// when it has one, else the app's windows (GtkWindows::raise).
void raiseApp() {
  if (gHost.appWindowShown) {
    gtk_window_present(GTK_WINDOW(gHost.appWindow));
  } else {
    gHost.windows->raise();
  }
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
  // A package (bin/package-linux.mjs) puts metadata.json beside the host, which links from bin/ to
  // lib/<name>/: the folder of the executable itself, not of the link.
  std::string folder;
  if (gchar *self = g_file_read_link("/proc/self/exe", nullptr)) {
    folder = directoryOf(self);
    g_free(self);
  }
  auto metadata = folder.empty() ? std::variant<ngn::LaunchSources::Lookup, std::string>() : ngn::packagedMetadata(folder);
  if (auto *problem = std::get_if<std::string>(&metadata)) {
    fprintf(stderr, "ngn-linux: %s\n", problem->c_str());
    return 2;
  }
  auto launch = ngn::launchSettings(
      {
          .args = args,
          .env = [](const std::string &name) -> std::optional<std::string> {
            const char *value = getenv(name.c_str());
            return value ? std::optional<std::string>(value) : std::nullopt;
          },
          .plist = std::get<ngn::LaunchSources::Lookup>(metadata),
          .resourcePath = folder,
      },
      os);
  if (auto *usage = std::get_if<std::string>(&launch)) {
    fprintf(stderr, "%s\n", usage->c_str());
    return 2;
  }
  static const auto settings = std::get<ngn::LaunchSettings>(launch);
  std::string bundle = settings.bundle;
  std::string appId = settings.appId.empty() ? settings.title : settings.appId;
  ngn::installCrashReport(
      ngn::crashReportPath(
          appId, settings.test ? std::optional<std::string>(settings.test->stateDir) : std::nullopt,
          [](const std::string &name) -> std::optional<std::string> {
            const char *value = getenv(name.c_str());
            return value ? std::optional<std::string>(value) : std::nullopt;
          }),
      os.program);
  // As on macOS, only a run from a dev server plays one, and a test launch, which screens-check's
  // Linux mode makes on an exported bundle.
  if (!settings.inputScript.empty() && (settings.test || ngn::DevServer::fromBundleUrl(bundle))) {
    gInputScript = settings.inputScript;
  }

  gtk_init();
  adw_init();
  // One instance of the app, as a Linux app has one: a test launch is its own, beside any other.
  gHost.application = ngn::gtk::startApplication(appId, !settings.test, settings.dbusService);
  if (g_application_get_is_remote(G_APPLICATION(gHost.application))) {
    auto args = settings.openArgs;
    if (!settings.initialUrl.empty()) {
      args.push_back(settings.initialUrl);
    }
    ngn::gtk::forwardLaunch(gHost.application, args);
    fprintf(stderr, "[ngn] %s is already running: this launch went to it\n", appId.c_str());
    return 0;
  }
  const char *desktop = getenv("XDG_CURRENT_DESKTOP");
  const auto menuPlacement = ngn::linuxMenuPlacement(desktop ? desktop : "");

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
  gHost.backend->hooks = {
      .containerRoot =
          [](facebook::react::Tag tag, bool root) {
            if (!gHost.mounting) {
              return;
            }
            if (root) {
              gHost.mounting->tree().addContainerRoot(tag);
            } else {
              gHost.mounting->tree().removeContainerRoot(tag);
            }
          },
      .attachInput =
          [](GtkWidget *slot, SurfaceId surface, facebook::react::Tag tag) {
            ngn::gtk::attachPointerInput(slot, surface, static_cast<ngn::ContainerId>(tag), gHost.input.get());
            gHost.input->addContainer(static_cast<ngn::ContainerId>(tag), surface, tag);
          },
      .detachInput =
          [](facebook::react::Tag tag) {
            if (gHost.input) {
              gHost.input->removeContainer(static_cast<ngn::ContainerId>(tag));
            }
          },
  };
  gHost.backend->modals().setSheetNodes([](SurfaceId surface, facebook::react::Tag tag) -> std::optional<ngn::SheetNode> {
    return gHost.runtime ? gHost.runtime->sheetNode(surface, tag) : std::nullopt;
  });
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
      if (GtkWidget *widget = surfaceWidgetOf(surface)) {
        GdkCursor *shown = ngn::gtk::makeCursor(cursor);
        gtk_widget_set_cursor(widget, shown);
        g_clear_object(&shown);
      }
    }
  };

  int width = static_cast<int>(ngn::kDefaultWindowWidth), height = static_cast<int>(ngn::kDefaultWindowHeight);
  gHost.appWindow = adw_application_window_new(gHost.application);
  gtk_window_set_title(GTK_WINDOW(gHost.appWindow), settings.title.c_str());
  gtk_window_set_default_size(GTK_WINDOW(gHost.appWindow), width, height);
  gHost.appSurface = ngn::gtk::makeSurfaceWidget(kAppSurface, [](int w, int h) {
    reportContainer(kAppSurface);
    // Each allocation, a new size or a new scale: Dimensions follows the window, as on macOS.
    if (gHost.state) {
      gHost.state->metrics.set(windowMetrics(w, h));
    }
    if (gHost.runtime) {
      gHost.runtime->updateSurface(kAppSurface, metricsFor(w, h, gtk_widget_get_scale_factor(gHost.appWindow)));
    }
  });
  adw_application_window_set_content(ADW_APPLICATION_WINDOW(gHost.appWindow), ngn::gtk::wrapInChrome(gHost.appSurface, {.menus = menuPlacement}));
  addSurface(kAppSurface, gHost.appSurface);
  g_signal_connect(gHost.appWindow, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer) -> gboolean {
    gHost.quit = true;
    return FALSE;
  }), nullptr);
  gtk_widget_realize(gHost.appWindow);
  ngn::gtk::afterLayout(gHost.appWindow, [] { reportContainer(kAppSurface); });
  // A move to a monitor of another scale changes no size, so the surface would not hear of it.
  g_signal_connect(gHost.appWindow, "notify::scale-factor", G_CALLBACK(+[](GObject *, GParamSpec *, gpointer) {
    // One declaration each: a comma here would split G_CALLBACK's argument.
    int w = gtk_widget_get_width(gHost.appSurface);
    int h = gtk_widget_get_height(gHost.appSurface);
    if (gHost.state) {
      gHost.state->metrics.set(windowMetrics(w, h));
    }
    if (gHost.runtime) {
      gHost.runtime->updateSurface(kAppSurface, metricsFor(w, h, gtk_widget_get_scale_factor(gHost.appWindow)));
    }
  }), nullptr);

  // The app's folders: a test launch's own, else the XDG ones named for the app.
  std::string appData = settings.test ? settings.test->applicationSupport() : joined(g_get_user_data_dir(), appId);
  std::string caches = settings.test ? settings.test->caches() : joined(g_get_user_cache_dir(), appId);
  g_mkdir_with_parents(caches.c_str(), 0700);
  auto system = ngn::gtk::makeSystem(appId, appData);
  gHost.state = std::make_shared<ngn::HostState>();
  gHost.state->metrics.set(windowMetrics(width, height));
  if (!settings.initialUrl.empty()) {
    gHost.state->setInitialUrl(settings.initialUrl);
  }
  // The links and files a launcher opened the app on: the first is its initial URL.
  for (const auto &url : ngn::gtk::openUrls(settings.openArgs)) {
    gHost.state->receiveUrl(url, false);
  }
  auto curl = ngn::makeCurlNetwork();
  ngn::NetworkClients network{curl.http, curl.webSockets};
  // Images load through the same client, and are kept in memory for the process.
  ngn::gtk::useImageLoading(network.http, std::make_shared<ngn::ImageCache>("", 64 << 20));
  ngn::gtk::onScrollOffset([](facebook::react::Tag tag, facebook::react::Point offset) {
    gHost.mounting->tree().setScrollOffset(tag, offset);
  });

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
            reportContainer(surface);
            if (gHost.runtime) {
              gHost.runtime->updateSurface(surface, metricsFor(w, h, scale));
            }
          },
      .stopSurface =
          [](SurfaceId surface) {
            gHost.runtime->stopSurface(surface);
            gHost.mounting->removeContainerInsets(surface);
            gHost.reported.erase(surface);
            gHost.input->removeContainer(surface);
            gHost.backend->removeSurface(surface);
            gHost.surfaces.erase(surface);
          },
      .laidOut = reportContainer,
      .quit = [] { gHost.quit = true; },
      // The app's own window, once shown, keeps the app running; closing it quits.
      .lastWindowClosed =
          [] {
            if (!gHost.appWindowShown) {
              gHost.quit = true;
            }
          },
  }, gHost.application, menuPlacement);
  auto windowHost = std::make_shared<ngn::WindowHost>(gHost.windows, system);
  gHost.windows->setHost(windowHost);
  // A second launch, or the session bus: activate raises the app, and open hands it links and
  // files, which DeepLinks hears (the initial URL until the app has drawn).
  g_signal_connect(gHost.application, "activate", G_CALLBACK(+[](GApplication *, gpointer) { raiseApp(); }), nullptr);
  g_signal_connect(gHost.application, "open", G_CALLBACK(+[](GApplication *, GFile **files, gint count, const gchar *, gpointer) {
    for (gint i = 0; i < count; ++i) {
      gchar *uri = g_file_get_uri(files[i]);
      gHost.state->receiveUrl(uri, gHost.firstFrame);
      g_free(uri);
    }
    raiseApp();
  }), nullptr);
  auto menus = std::make_shared<ngn::MenuHost>(
      ngn::gtk::makeNoMenus(),
      ngn::DefaultMenuOptions{.appName = settings.title, .developer = ngn::DevServer::fromBundleUrl(bundle).has_value(), .os = os});
  auto tray = std::make_shared<ngn::TrayHost>(ngn::gtk::makeNoTray());
  auto dock = std::make_shared<ngn::DockHost>(ngn::gtk::makeNoDock());
  // The Expo Updates client, off: this backend has no crypto yet, which a fetched update needs
  // to be checked, so it never fetches one. The bundle runs as given.
  auto updatesConfig = ngn::updatesConfigFrom(settings, os, appData, bundle);
  updatesConfig.off = "Updates are off: the Linux host has no update checks yet.";
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

  ngn::gtk::watchFontScale(followFontScale);

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
