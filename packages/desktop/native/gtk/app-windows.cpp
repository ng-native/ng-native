#include "app-windows.h"

#include "screens.h"
#include "view-widget.h"

#include <adwaita.h>

#include <algorithm>
#include <cmath>
#include <cstdio>

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

GtkApplication *startApplication(const std::string &appId) {
  AdwApplication *app = adw_application_new(g_application_id_is_valid(appId.c_str()) ? appId.c_str() : nullptr, G_APPLICATION_NON_UNIQUE);
  GError *error = nullptr;
  if (!g_application_register(G_APPLICATION(app), nullptr, &error)) {
    fprintf(stderr, "[ngn] could not register the application: %s\n", error ? error->message : "unknown");
    g_clear_error(&error);
  }
  return GTK_APPLICATION(app);
}

void afterLayout(GtkWidget *window, std::function<void()> laidOut) {
  GdkFrameClock *clock = gtk_widget_get_frame_clock(window);
  if (!clock) {
    return;
  }
  g_signal_connect_data(
      clock, "paint", G_CALLBACK(+[](GdkFrameClock *, gpointer data) { (*static_cast<std::function<void()> *>(data))(); }),
      new std::function<void()>(std::move(laidOut)), [](gpointer data, GClosure *) { delete static_cast<std::function<void()> *>(data); },
      GConnectFlags(0));
}

namespace {

struct CloseRequest {
  GtkWindows *windows;
  SurfaceId surface;
};

} // namespace

GtkWindows::GtkWindows(Hooks hooks, GtkApplication *application, MenuPlacement menus)
    : hooks_(std::move(hooks)), application_(application), menus_(menus) {}

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
  GtkWidget *widget = makeSurfaceWidget(surface, [this, surface, window](int w, int h) {
    if (hooks_.resizeSurface) {
      hooks_.resizeSurface(surface, w, h, gtk_widget_get_scale_factor(window));
    }
  });
  if (request.minWidth || request.minHeight) {
    gtk_widget_set_size_request(widget, static_cast<int>(request.minWidth.value_or(-1)), static_cast<int>(request.minHeight.value_or(-1)));
  }
  adw_application_window_set_content(ADW_APPLICATION_WINDOW(window), wrapInChrome(widget, {.titleBar = request.titleBar, .menus = menus_}));
  windows_[surface] = {.window = window, .surface = widget};
  // A move to a monitor of another scale changes no size, so the surface widget does not report it.
  g_signal_connect_data(
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
  g_signal_connect_data(
      window, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer data) -> gboolean {
        auto *r = static_cast<CloseRequest *>(data);
        auto host = r->windows->host_.lock();
        // The app decides, when it listens; otherwise the window closes as the OS would close it.
        if (!host || host->closeRequested(r->surface)) {
          r->windows->close(r->surface);
          // Linux's convention: the app quits when the user closes its last window. Only here, not
          // in close: a reload closes the app's windows too, before it opens their replacements.
          if (r->windows->windows_.empty() && r->windows->hooks_.lastWindowClosed) {
            r->windows->hooks_.lastWindowClosed();
          }
        }
        return TRUE;
      }),
      request_, [](gpointer data, GClosure *) { delete static_cast<CloseRequest *>(data); }, GConnectFlags(0));
  if (hooks_.addSurface) {
    hooks_.addSurface(surface, widget);
  }
  // Realized, so the surface knows its scale, but not shown until its first frame mounts.
  gtk_widget_realize(window);
  afterLayout(window, [this, surface] {
    if (hooks_.laidOut) {
      hooks_.laidOut(surface);
    }
  });
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
  windows_.erase(it);
  if (hooks_.stopSurface) {
    hooks_.stopSurface(surface);
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
