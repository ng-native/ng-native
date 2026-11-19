#include "app-windows.h"

#include "screens.h"
#include "view-widget.h"

#include <adwaita.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <utility>

namespace ngn::gtk {

void onMainContext(std::function<void()> task) {
  auto *heap = new std::function<void()>(std::move(task));
  // Queued for the loop to dispatch, always: g_main_context_invoke runs the task on the calling
  // thread when it can take the context, which another thread can between two of the loop's turns.
  g_idle_add_full(
      G_PRIORITY_DEFAULT,
      [](gpointer data) -> gboolean {
        (*static_cast<std::function<void()> *>(data))();
        return G_SOURCE_REMOVE;
      },
      heap, [](gpointer data) { delete static_cast<std::function<void()> *>(data); });
}

void runAfter(double seconds, std::function<void()> task) {
  auto *heap = new std::function<void()>(std::move(task));
  g_timeout_add_full(
      G_PRIORITY_DEFAULT, static_cast<guint>(std::max(0.0, seconds) * 1000),
      [](gpointer data) -> gboolean {
        (*static_cast<std::function<void()> *>(data))();
        return G_SOURCE_REMOVE;
      },
      heap, [](gpointer data) { delete static_cast<std::function<void()> *>(data); });
}

GtkApplication *startApplication(const std::string &appId, bool unique, bool service) {
  bool named = g_application_id_is_valid(appId.c_str());
  int flags = G_APPLICATION_HANDLES_OPEN;
  // A single instance needs a name to find the first by; a service is one by its name.
  flags |= unique && named ? 0 : G_APPLICATION_NON_UNIQUE;
  if (service && named) {
    flags = G_APPLICATION_HANDLES_OPEN | G_APPLICATION_IS_SERVICE;
  }
  AdwApplication *app = adw_application_new(named ? appId.c_str() : nullptr, static_cast<GApplicationFlags>(flags));
  GError *error = nullptr;
  if (!g_application_register(G_APPLICATION(app), nullptr, &error)) {
    fprintf(stderr, "[ngn] could not register the application: %s\n", error ? error->message : "unknown");
    g_clear_error(&error);
  }
  return GTK_APPLICATION(app);
}

void forwardLaunch(GtkApplication *application, const std::vector<std::string> &openArgs) {
  std::vector<GFile *> files;
  for (const auto &arg : openArgs) {
    files.push_back(g_file_new_for_commandline_arg(arg.c_str()));
  }
  if (files.empty()) {
    g_application_activate(G_APPLICATION(application));
  } else {
    g_application_open(G_APPLICATION(application), files.data(), static_cast<gint>(files.size()), "");
  }
  for (GFile *file : files) {
    g_object_unref(file);
  }
  // The calls go out before the process does.
  if (GDBusConnection *bus = g_application_get_dbus_connection(G_APPLICATION(application))) {
    g_dbus_connection_flush_sync(bus, nullptr, nullptr);
  }
}

std::vector<std::string> openUrls(const std::vector<std::string> &openArgs) {
  std::vector<std::string> urls;
  for (const auto &arg : openArgs) {
    GFile *file = g_file_new_for_commandline_arg(arg.c_str());
    gchar *uri = g_file_get_uri(file);
    // A link GIO has no backend for keeps its own text, which g_file_get_uri also gives back.
    urls.emplace_back(uri ? uri : arg);
    g_free(uri);
    g_object_unref(file);
  }
  return urls;
}

gulong afterLayout(GtkWidget *window, std::function<void()> laidOut) {
  GdkFrameClock *clock = gtk_widget_get_frame_clock(window);
  if (!clock) {
    return 0;
  }
  return g_signal_connect_data(
      clock, "paint", G_CALLBACK(+[](GdkFrameClock *, gpointer data) { (*static_cast<std::function<void()> *>(data))(); }),
      new std::function<void()>(std::move(laidOut)), [](gpointer data, GClosure *) { delete static_cast<std::function<void()> *>(data); },
      GConnectFlags(0));
}

namespace {

struct CloseRequest {
  GtkWindows *windows;
  SurfaceId surface;
};

// A window's own report of a change to the GtkWindows it belongs to.
struct WindowSignal {
  GtkWindows *windows;
  SurfaceId surface;
  void (*report)(GtkWindows *, SurfaceId, GtkWindow *);
};

void connectWindow(GtkWidget *window, const char *signal, WindowSignal data) {
  g_signal_connect_data(
      window, signal, G_CALLBACK(+[](GtkWindow *w, GParamSpec *, gpointer p) {
        auto *s = static_cast<WindowSignal *>(p);
        s->report(s->windows, s->surface, w);
      }),
      new WindowSignal(data), [](gpointer p, GClosure *) { delete static_cast<WindowSignal *>(p); }, GConnectFlags(0));
}

} // namespace

bool GtkWindows::fillsScreen(GtkWindow *window) {
  return gtk_window_is_maximized(window) || gtk_window_is_fullscreen(window);
}

GtkWindows::GtkWindows(Hooks hooks, GtkApplication *application, MenuPlacement menus)
    : hooks_(std::move(hooks)), application_(application), menus_(menus) {}

GtkWindows::~GtkWindows() {
  // Handlers first, which call back into these, then the windows still open.
  auto open = std::exchange(windows_, {});
  for (auto &[surface, entry] : open) {
    disconnect(entry);
    gtk_window_destroy(GTK_WINDOW(entry.window));
  }
}

void GtkWindows::disconnect(Window &entry) {
  g_clear_signal_handler(&entry.scaled, entry.window);
  g_clear_signal_handler(&entry.closeRequested, entry.window);
  if (entry.clock) {
    g_clear_signal_handler(&entry.laidOut, entry.clock);
    g_clear_object(&entry.clock);
  }
}

void GtkWindows::setHost(std::weak_ptr<WindowHost> host) {
  host_ = std::move(host);
}

GtkWidget *GtkWindows::window(SurfaceId surface) const {
  auto it = windows_.find(surface);
  return it == windows_.end() ? nullptr : it->second.window;
}

GtkWidget *GtkWindows::surfaceWidget(SurfaceId surface) const {
  auto it = windows_.find(surface);
  return it == windows_.end() ? nullptr : it->second.surface;
}

void GtkWindows::openWindow(SurfaceId surface, const WindowRequest &request, const WindowPlacement &placement, std::function<void()> opened) {
  onMainContext([this, surface, request, placement, opened = std::move(opened)] { open(surface, request, placement, opened); });
}

void GtkWindows::open(SurfaceId surface, const WindowRequest &request, const WindowPlacement &placement, std::function<void()> opened) {
  int width = static_cast<int>(std::lround(placement.frame.width > 0 ? placement.frame.width : request.width.value_or(kDefaultWindowWidth)));
  int height = static_cast<int>(std::lround(placement.frame.height > 0 ? placement.frame.height : request.height.value_or(kDefaultWindowHeight)));
  GtkWidget *window = adw_application_window_new(application_);
  gtk_window_set_title(GTK_WINDOW(window), request.title.c_str());
  gtk_window_set_default_size(GTK_WINDOW(window), width, height);
  gtk_window_set_resizable(GTK_WINDOW(window), request.resizable);
  // Back as it was saved: at its size, and maximised or full screen. GTK places it.
  if (placement.frame.maximized && request.resizable) {
    gtk_window_maximize(GTK_WINDOW(window));
  }
  if (placement.frame.fullScreen || request.fullScreen) {
    gtk_window_fullscreen(GTK_WINDOW(window));
  }
  GtkWidget *widget = makeSurfaceWidget(surface, [this, surface, window](int w, int h) {
    if (hooks_.resizeSurface) {
      hooks_.resizeSurface(surface, w, h, gtk_widget_get_scale_factor(window));
    }
    // A window that fills the screen has the size GTK allocates, which arrives after the
    // notify::maximized or notify::fullscreened that reported the old one.
    reportFrame(surface, true);
  });
  if (request.minWidth || request.minHeight) {
    gtk_widget_set_size_request(widget, static_cast<int>(request.minWidth.value_or(-1)), static_cast<int>(request.minHeight.value_or(-1)));
  }
  adw_application_window_set_content(ADW_APPLICATION_WINDOW(window), wrapInChrome(widget, {.titleBar = request.titleBar, .menus = menus_}));
  windows_[surface] = {.window = window, .surface = widget};
  // A move to a monitor of another scale changes no size, so the surface widget does not report it.
  Window &entry = windows_[surface];
  entry.scaled = g_signal_connect_data(
      window, "notify::scale-factor", G_CALLBACK(+[](GtkWidget *scaled, GParamSpec *, gpointer data) {
        auto *r = static_cast<CloseRequest *>(data);
        GtkWidget *content = r->windows->surfaceWidget(r->surface);
        if (content && r->windows->hooks_.resizeSurface) {
          r->windows->hooks_.resizeSurface(
              r->surface, gtk_widget_get_width(content), gtk_widget_get_height(content), gtk_widget_get_scale_factor(scaled));
        }
      }),
      new CloseRequest{this, surface}, [](gpointer data, GClosure *) { delete static_cast<CloseRequest *>(data); }, GConnectFlags(0));
  auto *request_ = new CloseRequest{this, surface};
  entry.closeRequested = g_signal_connect_data(
      window, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer data) -> gboolean {
        auto *r = static_cast<CloseRequest *>(data);
        auto host = r->windows->host_.lock();
        // The app decides, when it listens; otherwise the window closes as the OS would close it.
        if (!host || host->closeRequested(r->surface)) {
          r->windows->close(r->surface);
          // Linux's convention: the app quits when the user closes its last window, unless an app
          // listens, whose quitWhenLastWindowCloses decides instead (WindowHost::lastWindowClosed).
          // Only here, not in close: a reload closes the app's windows too, before it opens their
          // replacements.
          if (r->windows->windows_.empty() && (!host || host->lastWindowClosed()) && r->windows->hooks_.lastWindowClosed) {
            r->windows->hooks_.lastWindowClosed();
          }
        }
        return TRUE;
      }),
      request_, [](gpointer data, GClosure *) { delete static_cast<CloseRequest *>(data); }, GConnectFlags(0));
  for (const char *signal : {"notify::default-width", "notify::default-height", "notify::maximized", "notify::fullscreened"}) {
    connectWindow(window, signal, {this, surface, [](GtkWindows *windows, SurfaceId s, GtkWindow *) { windows->reportFrame(s); }});
  }
  connectWindow(window, "notify::is-active", {this, surface, [](GtkWindows *windows, SurfaceId s, GtkWindow *w) {
    windows->reportFocus(s, gtk_window_is_active(w));
  }});
  if (hooks_.addSurface) {
    hooks_.addSurface(surface, widget);
  }
  // Realized, so the surface knows its scale, but not shown until its first frame mounts.
  gtk_widget_realize(window);
  entry.laidOut = afterLayout(window, [this, surface] {
    if (hooks_.laidOut) {
      hooks_.laidOut(surface);
    }
  });
  // Held with the handler, which goes before the window: the clock is its surface's until then.
  if (entry.laidOut) {
    entry.clock = GDK_FRAME_CLOCK(g_object_ref(gtk_widget_get_frame_clock(window)));
  }
  if (hooks_.startSurface) {
    hooks_.startSurface(surface, width, height, gtk_widget_get_scale_factor(window));
  }
  if (opened) {
    opened();
  }
}

void presentWithoutInitialFocus(GtkWindow *window) {
  // GTK focuses the first widget it can as it shows a window with no focus, and the widget hears
  // of it at once, active window or not: so for that moment nothing in it can take the focus.
  GtkWidget *content = gtk_window_get_child(window);
  bool hold = !gtk_root_get_focus(GTK_ROOT(window)) && content && gtk_widget_get_can_focus(content);
  if (hold) {
    gtk_widget_set_can_focus(content, FALSE);
  }
  gtk_window_present(window);
  if (hold) {
    gtk_widget_set_can_focus(content, TRUE);
  }
}

void GtkWindows::didMount(SurfaceId surface) {
  auto it = windows_.find(surface);
  if (it == windows_.end() || it->second.shown) {
    return;
  }
  it->second.shown = true;
  presentWithoutInitialFocus(GTK_WINDOW(it->second.window));
  // The app learns the size the window opened at, which a saved frame decides.
  reportFrame(surface);
}

void GtkWindows::reportFrame(SurfaceId surface, bool onAllocation) {
  auto it = windows_.find(surface);
  auto host = host_.lock();
  // A window still waiting for its first frame has not been sized by the user.
  if (it == windows_.end() || !it->second.shown || !host) {
    return;
  }
  GtkWindow *window = GTK_WINDOW(it->second.window);
  bool maximized = gtk_window_is_maximized(window);
  bool fullScreen = gtk_window_is_fullscreen(window);
  bool fills = windowFills(window);
  // An allocation of a window with a size of its own changes nothing the app was not told.
  if (onAllocation && !fills) {
    return;
  }
  // The default size is the one the window has, or goes back to when it fills the screen.
  int width = 0, height = 0;
  gtk_window_get_default_size(window, &width, &height);
  WindowFrame saved{.width = static_cast<double>(width), .height = static_cast<double>(height), .maximized = maximized, .fullScreen = fullScreen};
  WindowFrame now = saved;
  if (fills && gtk_widget_get_width(it->second.surface) > 0) {
    now.width = gtk_widget_get_width(it->second.surface);
    now.height = gtk_widget_get_height(it->second.surface);
  }
  // Each allocation comes here, but the app hears a size once.
  if (onAllocation && now.width == it->second.reportedWidth && now.height == it->second.reportedHeight) {
    return;
  }
  if (width > 0 && height > 0) {
    it->second.reportedWidth = now.width;
    it->second.reportedHeight = now.height;
    host->resized(surface, now, gtk_widget_get_scale_factor(it->second.window), saved);
  }
}

void GtkWindows::reportFocus(SurfaceId surface, bool active) {
  auto host = host_.lock();
  // A window going, which close already reported, says nothing more.
  if (!host || !windows_.contains(surface)) {
    return;
  }
  if (active) {
    host->focused(surface);
  } else if (host->focusedSurface() == surface) {
    host->focused(std::nullopt);
  }
}

void GtkWindows::raise() {
  // GTK lists an application's windows most recently active first.
  for (GList *l = gtk_application_get_windows(application_); l; l = l->next) {
    GtkWindow *window = GTK_WINDOW(l->data);
    for (const auto &[surface, open] : windows_) {
      if (open.window == GTK_WIDGET(window) && open.shown) {
        gtk_window_present(window);
        return;
      }
    }
  }
  if (auto host = host_.lock()) {
    host->reopen(false);
  }
}

void GtkWindows::closeWindow(SurfaceId surface) {
  onMainContext([this, surface] { close(surface); });
}

void GtkWindows::close(SurfaceId surface) {
  auto it = windows_.find(surface);
  if (it == windows_.end()) {
    return;
  }
  GtkWidget *window = it->second.window;
  disconnect(it->second);
  windows_.erase(it);
  if (hooks_.stopSurface) {
    hooks_.stopSurface(surface);
  }
  auto host = host_.lock();
  if (host && host->focusedSurface() == surface) {
    host->focused(std::nullopt);
  }
  gtk_window_destroy(GTK_WINDOW(window));
}

void GtkWindows::focusWindow(SurfaceId surface) {
  onMainContext([this, surface] {
    if (GtkWidget *w = window(surface)) {
      gtk_window_present(GTK_WINDOW(w));
    }
  });
}

void GtkWindows::setWindowTitle(SurfaceId surface, const std::string &title) {
  onMainContext([this, surface, title] {
    if (GtkWidget *w = window(surface)) {
      gtk_window_set_title(GTK_WINDOW(w), title.c_str());
    }
  });
}

void GtkWindows::beginQuit() {
  onMainContext([this] {
    auto host = host_.lock();
    if (!host || host->quitRequested() == QuitReply::Now) {
      if (hooks_.quit) {
        hooks_.quit();
      }
    }
  });
}

void GtkWindows::replyToQuit(bool proceed) {
  if (proceed) {
    onMainContext([this] {
      if (hooks_.quit) {
        hooks_.quit();
      }
    });
  }
}

void GtkWindows::after(double seconds, std::function<void()> task) {
  runAfter(seconds, std::move(task));
}

} // namespace ngn::gtk
