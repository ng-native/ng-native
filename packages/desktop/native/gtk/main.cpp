// ngn-linux: the desktop host on GTK 4. Loads a bundle into one runtime and starts the app, composed
// as every desktop host is (makeHostViews, addCoreModules and addDesktopModules) over Linux's
// HostOs. The app's windows each have a surface (app-windows.h); the app's own surface gets a
// window only when the app renders into it.
//
//   ngn-linux <bundle> [--module <name>] [--title <title>] [--app-id <id>]
//   ngn-linux             (a packaged app: what the metadata.json beside it names; argv and env
//                          are ignored)
//
// NGN_CAPTURE=<file.png> saves the first window's content, drawn in-process (capture.h), a second
// after its first frame, or with an input script (NGN_INPUT_SCRIPT) a second after the script has
// played.
#include "app-windows.h"
#include "capture.h"
#include "file-system.h"
#include "focus.h"
#include "gtk-backend.h"
#include "host-sources.h"
#include "image-view.h"
#include "input-replay.h"
#include "launcher-badge.h"
#include "menus.h"
#include "pango-text.h"
#include "scroll-view.h"
#include "secret-store.h"
#include "status-notifier.h"
#include "surface-input.h"
#include "system-access.h"
#include "view-widget.h"

#include "ngn/core-modules.h"
#include "ngn/crash-report.h"
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
  std::shared_ptr<ngn::MenuHost> menus;
  std::shared_ptr<ngn::gtk::GtkMenus> gtkMenus;
  // The app's undo history, which Edit > Undo and Redo run while no text input has the focus.
  std::shared_ptr<ngn::UndoManager> undo = ngn::gtk::makeUndoManager();
  ngn::HostOs os;
  std::string bundle;
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

// A dev or test run's input script (NGN_INPUT_SCRIPT), played into the first window once it shows.
std::string gInputScript;

// Whether it plays; `done` runs once it has.
bool playInputScript(GtkWidget *window, std::function<void()> done) {
  gchar *text = nullptr;
  if (!g_file_get_contents(gInputScript.c_str(), &text, nullptr, nullptr)) {
    fprintf(stderr, "[ngn] input script %s: cannot be read\n", gInputScript.c_str());
    return false;
  }
  auto script = ngn::parseInputScript(text);
  g_free(text);
  return ngn::gtk::replayInputScript(window, std::move(script), std::move(done));
}

// NGN_CAPTURE's screenshot of `surface`, a second from now, unless its window has gone.
void captureSoon(GtkWidget *surface, std::string file) {
  auto *alive = new GtkWidget *(surface);
  g_object_add_weak_pointer(G_OBJECT(surface), reinterpret_cast<gpointer *>(alive));
  ngn::gtk::runAfter(1, [file, alive] {
    if (*alive) {
      bool saved = ngn::gtk::captureWidget(*alive, file);
      fprintf(stderr, saved ? "[ngn] captured %s\n" : "[ngn] could not capture %s\n", file.c_str());
      g_object_remove_weak_pointer(G_OBJECT(*alive), reinterpret_cast<gpointer *>(alive));
    }
    delete alive;
  });
}

// The first window's first frame, once drawn: logged, given the run's input script, and captured
// when asked, a second after the script has played (or after the frame, without one).
void firstFrameDrawn(GtkWidget *surface) {
  fprintf(stderr, "[ngn] first frame %.0f ms after launch\n", (g_get_monotonic_time() - gHost.launched) / 1000.0);
  const char *path = getenv("NGN_CAPTURE");
  std::string file = path ? path : "";
  std::function<void()> capture;
  if (!file.empty()) {
    capture = [surface, file] { captureSoon(surface, file); };
  }
  bool playing = !gInputScript.empty() && playInputScript(GTK_WIDGET(gtk_widget_get_root(surface)), capture);
  if (capture && !playing) {
    capture();
  }
}

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
    firstFrameDrawn(static_cast<GtkWidget *>(surface));
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
// The surface whose window `window` is, if any.
std::optional<SurfaceId> surfaceOfWindow(GtkWindow *window) {
  for (SurfaceId surface : gHost.surfaces) {
    if (GtkWidget *widget = surfaceWidgetOf(surface); widget && gtk_widget_get_root(widget) == GTK_ROOT(window)) {
      return surface;
    }
  }
  return std::nullopt;
}

void navigate(ngn::NavigationDirection direction, GtkWindow *window) {
  gHost.menus->navigate(direction, window ? surfaceOfWindow(window) : std::nullopt);
}

// What a text input does itself, by GTK's action for it on the focused widget.
const char *textAction(ngn::MenuCommand command) {
  switch (command) {
    case ngn::MenuCommand::Undo: return "text.undo";
    case ngn::MenuCommand::Redo: return "text.redo";
    case ngn::MenuCommand::Cut: return "clipboard.cut";
    case ngn::MenuCommand::Copy: return "clipboard.copy";
    case ngn::MenuCommand::Paste:
    case ngn::MenuCommand::PasteAndMatchStyle: return "clipboard.paste";
    case ngn::MenuCommand::Delete: return "selection.delete";
    case ngn::MenuCommand::SelectAll: return "selection.select-all";
    default: return nullptr;
  }
}

// A menu item chosen, from a menu or by its key, in `window` (the active one when null). The host
// runs the OS's commands; the rest go to the core (MenuHost::choose), which sends the app's.
void runMenuItem(const ngn::MenuItem &item, GtkWindow *window) {
  if (!window) {
    window = gtk_application_get_active_window(gHost.application);
  }
  switch (item.command) {
    case ngn::MenuCommand::Reload:
      gHost.runtime->reload();
      return;
    case ngn::MenuCommand::OpenDevTools:
      gHost.runtime->openDebugger();
      return;
    case ngn::MenuCommand::Quit:
      gHost.windows->beginQuit();
      return;
    case ngn::MenuCommand::ToggleSidebar:
      // The window's split view (split-view.h); a window without one leaves it to the app.
      if (auto surface = window ? surfaceOfWindow(window) : std::nullopt; surface && gHost.backend->splitViews().toggle(*surface)) {
        return;
      }
      break;
    case ngn::MenuCommand::CloseWindow:
      // The sheet, cover or popover in front first, as Escape asks it to close; then the window, as
      // the close button does: the app decides (close-request).
      if (auto front = window ? gHost.backend->modals().front(window) : std::nullopt) {
        gHost.backend->modals().requestClose(*front);
      } else if (window) {
        gtk_window_close(window);
      }
      return;
    case ngn::MenuCommand::ToggleFullScreen:
      if (window) {
        gtk_window_is_fullscreen(window) ? gtk_window_unfullscreen(window) : gtk_window_fullscreen(window);
      }
      return;
    case ngn::MenuCommand::About: {
      GtkWidget *about = adw_about_window_new();
      adw_about_window_set_application_name(ADW_ABOUT_WINDOW(about), gHost.menus->options().appName.c_str());
      if (const char *id = g_application_get_application_id(G_APPLICATION(gHost.application))) {
        adw_about_window_set_application_icon(ADW_ABOUT_WINDOW(about), id);
      }
      if (window) {
        gtk_window_set_transient_for(GTK_WINDOW(about), window);
      }
      gtk_window_present(GTK_WINDOW(about));
      return;
    }
    default:
      break;
  }
  // Undo and Redo are a focused text input's own, else the app's, as on macOS.
  bool history = item.command == ngn::MenuCommand::Undo || item.command == ngn::MenuCommand::Redo;
  if (history && !(window && ngn::gtk::textInputFocused(window))) {
    item.command == ngn::MenuCommand::Undo ? gHost.undo->undo() : gHost.undo->redo();
    return;
  }
  if (const char *action = textAction(item.command)) {
    if (GtkWidget *focus = window ? gtk_root_get_focus(GTK_ROOT(window)) : nullptr) {
      gtk_widget_activate_action(focus, action, nullptr);
    }
    return;
  }
  gHost.menus->choose(item, window ? surfaceOfWindow(window) : std::nullopt);
}

// A window holding the app's surfaces: its menus, and its keys and side buttons routed as
// menus.h's KeyRouting orders them.
void routeWindow(GtkWidget *surfaceWidget) {
  auto *window = GTK_WINDOW(gtk_widget_get_root(surfaceWidget));
  if (!window || g_object_get_data(G_OBJECT(window), "ngn-keys")) {
    return;
  }
  g_object_set_data(G_OBJECT(window), "ngn-keys", GINT_TO_POINTER(1));
  ngn::gtk::trackFocus(window);
  gHost.gtkMenus->attach(surfaceWidget);
  ngn::gtk::routeKeys(window, std::make_shared<ngn::gtk::KeyRouting>(ngn::gtk::KeyRouting{
      .shortcut = [](const ngn::KeyChord &chord, bool text) { return gHost.menus->keyDown(chord, text); },
      .focus = [](GtkWindow *window, guint keyval, GdkModifierType state) {
        return ngn::gtk::moveFocusByKey(window, keyval, state, *gHost.backend, gHost.mounting->tree());
      },
      .navigation = [](const ngn::KeyChord &chord) { return ngn::navigationFor(chord, gHost.os); },
      .navigate = navigate,
      .menuKey = [](const ngn::KeyChord &chord) { return ngn::findMenuItem(gHost.gtkMenus->bar(), chord); },
      .choose = runMenuItem,
  }));
}

void addSurface(SurfaceId surface, GtkWidget *widget) {
  gHost.backend->addSurface(surface, widget);
  ngn::gtk::attachPointerInput(widget, surface, surface, gHost.input.get());
  gHost.input->addContainer(surface, surface, surface);
  gHost.surfaces.insert(surface);
  if (gHost.gtkMenus) {
    routeWindow(widget);
  }
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
  gHost.bundle = bundle;
  gHost.os = os;
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
  // A press that became a drag out of a `[dragItem]` view: the move that crossed the threshold
  // starts the drag, which has the pointer from there.
  gHost.input->onDragOut = [](facebook::react::Tag tag, const ngn::PointerInput &, const ngn::DragOutItem &item) {
    ngn::gtk::dragOutOfPointer(gHost.backend->view(tag), item);
  };

  int width = static_cast<int>(ngn::kDefaultWindowWidth), height = static_cast<int>(ngn::kDefaultWindowHeight);
  gHost.appWindow = adw_application_window_new(gHost.application);
  gtk_window_set_title(GTK_WINDOW(gHost.appWindow), settings.title.c_str());
  gtk_window_set_default_size(GTK_WINDOW(gHost.appWindow), width, height);
  gHost.appSurface = ngn::gtk::makeSurfaceWidget(kAppSurface, [](int w, int h) {
    reportContainer(kAppSurface);
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

  // The app's folders: a test launch's own, else the XDG ones named for the app.
  std::string appData = settings.test ? settings.test->applicationSupport() : joined(g_get_user_data_dir(), appId);
  std::string caches = settings.test ? settings.test->caches() : joined(g_get_user_cache_dir(), appId);
  g_mkdir_with_parents(caches.c_str(), 0700);
  auto system = ngn::gtk::makeSystem(appId, appData);
  gHost.state = std::make_shared<ngn::HostState>();
  gHost.state->metrics.set({
      .window = {.width = static_cast<double>(width), .height = static_cast<double>(height), .scale = 1, .fontScale = ngn::gtk::desktopFontScale()},
      .screen = {.width = 1920, .height = 1080, .scale = 1, .fontScale = ngn::gtk::desktopFontScale()},
  });
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

  static ngn::ProcessesSetup processes = ngn::gtk::processesSetup(os, settings.capabilitiesJson, ngn::gtk::insideFlatpak());
  auto folders = ngn::gtk::fileFolders(appData, caches, settings.test ? settings.test->temp() : g_get_tmp_dir());
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
            if (gHost.menus) {
              gHost.menus->forgetHistory(surface);
            }
            gHost.runtime->stopSurface(surface);
            gHost.mounting->removeContainerInsets(surface);
            gHost.reported.erase(surface);
            gHost.input->removeContainer(surface);
            gHost.backend->removeSurface(surface);
            gHost.surfaces.erase(surface);
          },
      .laidOut = reportContainer,
      .quit = [] { gHost.quit = true; },
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
  gHost.gtkMenus = std::make_shared<ngn::gtk::GtkMenus>([](const ngn::MenuItem &item) { runMenuItem(item, nullptr); });
  auto menus = std::make_shared<ngn::MenuHost>(
      gHost.gtkMenus, ngn::DefaultMenuOptions{.appName = settings.title, .developer = ngn::DevServer::fromBundleUrl(bundle).has_value(), .os = os});
  gHost.menus = menus;
  // Each window's history, as the app's router reports it, for its header bar's back and forward
  // pair, which goes through it.
  menus->historyChanged = [](SurfaceId surface) {
    gHost.backend->runOnUiThread([surface] {
      if (gHost.menus) {
        gHost.backend->headers().setHistory(surface, gHost.menus->history(surface));
      }
    });
  };
  gHost.backend->headers().navigate = [](SurfaceId surface, ngn::NavigationDirection direction, int steps) {
    gHost.menus->navigate(direction, surface, steps);
  };
  routeWindow(gHost.appSurface);
  // A view's context menu (its `contextMenu` prop), drawn where the secondary click was.
  ngn::gtk::setContextMenuShower([](GtkWidget *widget, const ngn::PointerInput &input) {
    auto target = gHost.input->contextMenuAt(input);
    if (!target) {
      return false;
    }
    auto tag = target->tag;
    auto *window = GTK_WINDOW(gtk_widget_get_root(widget));
    return ngn::gtk::popUpContextMenu(widget, input.point, target->items, [tag, window](const ngn::MenuItem &item) {
      if (item.command == ngn::MenuCommand::Back || item.command == ngn::MenuCommand::Forward) {
        navigate(item.command == ngn::MenuCommand::Back ? ngn::NavigationDirection::Back : ngn::NavigationDirection::Forward, window);
      } else {
        gHost.input->contextMenuSelect(tag, item.id);
      }
    });
  });
  // The tray only while a StatusNotifierWatcher runs, as the launch finds it; Linux has no Dock.
  std::shared_ptr<ngn::TrayHost> tray;
  if (ngn::gtk::statusNotifierWatcherRunning()) {
    auto host = std::make_shared<std::weak_ptr<ngn::TrayHost>>();
    tray = std::make_shared<ngn::TrayHost>(ngn::gtk::makeStatusNotifierTray(appId, {
        .press = [host](const std::string &icon) {
          if (auto tray = host->lock()) {
            tray->press(icon);
          }
        },
        .menuSelect = [host](const std::string &icon, const std::string &id) {
          if (auto tray = host->lock()) {
            tray->menuSelect(icon, id);
          }
        },
        .command = [](ngn::MenuCommand command) { runMenuItem({.command = command}, nullptr); },
    }));
    *host = tray;
  }
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
       .processes = processes,
       .shell = ngn::gtk::makeShellOpener(),
       .secrets = ngn::gtk::makeSecretStore(appId, ngn::gtk::insideFlatpak()),
       .sleep = ngn::gtk::makeSleepPreventer(gHost.application),
       .notifications = [appId](std::shared_ptr<ngn::NotificationEvents>) { return ngn::gtk::makeLauncherBadgeNotifications(appId); },
       .undo = gHost.undo,
       .fileWatcher = ngn::gtk::makeFileWatcher(),
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
