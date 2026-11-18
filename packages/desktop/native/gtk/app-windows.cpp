#include "app-windows.h"

#include "screens.h"
#include "view-widget.h"

#include <adwaita.h>

#include <algorithm>
#include <cmath>

namespace ngn::gtk {

void onMainContext(std::function<void()> task) {
  auto *heap = new std::function<void()>(std::move(task));
  g_main_context_invoke_full(
      nullptr, G_PRIORITY_DEFAULT,
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

namespace {

struct CloseRequest {
  GtkWindows *windows;
  SurfaceId surface;
};

} // namespace

GtkWindows::GtkWindows(Hooks hooks) : hooks_(std::move(hooks)) {}

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
  GtkWidget *window = adw_window_new();
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
  adw_window_set_content(ADW_WINDOW(window), wrapInChrome(widget));
  windows_[surface] = {.window = window, .surface = widget};
  auto *request_ = new CloseRequest{this, surface};
  g_signal_connect_data(
      window, "close-request", G_CALLBACK(+[](GtkWindow *, gpointer data) -> gboolean {
        auto *r = static_cast<CloseRequest *>(data);
        auto host = r->windows->host_.lock();
        // The app decides, when it listens; otherwise the window closes as the OS would close it.
        if (!host || host->closeRequested(r->surface)) {
          r->windows->close(r->surface);
        }
        return TRUE;
      }),
      request_, [](gpointer data, GClosure *) { delete static_cast<CloseRequest *>(data); }, GConnectFlags(0));
  if (hooks_.addSurface) {
    hooks_.addSurface(surface, widget);
  }
  // Realized, so the surface knows its scale, but not shown until its first frame mounts.
  gtk_widget_realize(window);
  if (hooks_.startSurface) {
    hooks_.startSurface(surface, width, height, gtk_widget_get_scale_factor(window));
  }
  if (opened) {
    opened();
  }
}

void GtkWindows::didMount(SurfaceId surface) {
  auto it = windows_.find(surface);
  if (it == windows_.end() || it->second.shown) {
    return;
  }
  it->second.shown = true;
  gtk_window_present(GTK_WINDOW(it->second.window));
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
  // Linux's convention: the app quits with its last window.
  if (windows_.empty() && hooks_.quit) {
    hooks_.quit();
  }
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
