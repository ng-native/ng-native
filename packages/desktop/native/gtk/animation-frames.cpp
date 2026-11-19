#include "animation-frames.h"

#include "ngn/worklet-host.h"

#include <gtk/gtk.h>

namespace ngn::gtk {
namespace {

// The window whose frame clock drives the frames, while a tick callback is on it; else a timer at
// 60 Hz while no window is shown. GTK's frame clock stops for a window that is not mapped, so a
// window going away or hiding hands the frames to another, as a display link moves screens on a Mac.
struct Driver {
  GtkWidget *window = nullptr;
  guint tick = 0;
  gulong unmapped = 0;
  guint timer = 0;
};

Driver &driver() {
  static Driver d;
  return d;
}

double nowMs() {
  return static_cast<double>(g_get_monotonic_time()) / 1000.0;
}

// The active window when it is shown, else any shown window, else none.
GtkWidget *shownWindow() {
  GtkWidget *found = nullptr;
  GListModel *windows = gtk_window_get_toplevels();
  guint count = g_list_model_get_n_items(windows);
  for (guint i = 0; i < count; ++i) {
    auto *window = GTK_WIDGET(g_list_model_get_item(windows, i));
    g_object_unref(window);
    if (!gtk_widget_get_mapped(window)) {
      continue;
    }
    if (gtk_window_is_active(GTK_WINDOW(window))) {
      return window;
    }
    if (!found) {
      found = window;
    }
  }
  return found;
}

void stopTick() {
  Driver &d = driver();
  if (!d.window) {
    return;
  }
  g_signal_handler_disconnect(d.window, d.unmapped);
  gtk_widget_remove_tick_callback(d.window, d.tick);
  g_object_remove_weak_pointer(G_OBJECT(d.window), reinterpret_cast<gpointer *>(&d.window));
  d.window = nullptr;
  d.tick = 0;
  d.unmapped = 0;
}

void stopTimer() {
  Driver &d = driver();
  if (d.timer != 0) {
    g_source_remove(d.timer);
    d.timer = 0;
  }
}

gboolean onTick(GtkWidget *, GdkFrameClock *clock, gpointer) {
  // The frame clock's time is GLib's monotonic clock, the one `now` reads.
  workletHost().frames.frame(static_cast<double>(gdk_frame_clock_get_frame_time(clock)) / 1000.0);
  if (workletHost().frames.wanted()) {
    return G_SOURCE_CONTINUE;
  }
  Driver &d = driver();
  g_signal_handler_disconnect(d.window, d.unmapped);
  g_object_remove_weak_pointer(G_OBJECT(d.window), reinterpret_cast<gpointer *>(&d.window));
  d.window = nullptr;
  d.tick = 0;
  d.unmapped = 0;
  return G_SOURCE_REMOVE;
}

gboolean onTimer(gpointer) {
  workletHost().frames.frame(nowMs());
  Driver &d = driver();
  d.timer = 0;
  // A window shown since takes the frames over; or the timer runs again while they are wanted.
  updateAnimationFrames();
  return G_SOURCE_REMOVE;
}

void onUnmapped(GtkWidget *, gpointer) {
  stopTick();
  updateAnimationFrames();
}

} // namespace

void updateAnimationFrames() {
  Driver &d = driver();
  if (!workletHost().frames.wanted()) {
    // The tick callback removes itself after the frame that leaves nothing waiting; a clear()
    // between frames stops them here.
    stopTick();
    stopTimer();
    return;
  }
  if (d.window) {
    return;
  }
  if (GtkWidget *window = shownWindow()) {
    stopTimer();
    d.window = window;
    g_object_add_weak_pointer(G_OBJECT(window), reinterpret_cast<gpointer *>(&d.window));
    d.tick = gtk_widget_add_tick_callback(window, onTick, nullptr, nullptr);
    d.unmapped = g_signal_connect(window, "unmap", G_CALLBACK(onUnmapped), nullptr);
    return;
  }
  if (d.timer == 0) {
    d.timer = g_timeout_add(16, onTimer, nullptr);
  }
}

void installWorkletHost(std::shared_ptr<MountingManager> mounting, std::shared_ptr<GtkBackend> backend) {
  auto &host = workletHost();
  std::weak_ptr<GtkBackend> weakBackend = backend;
  host.runOnUiThread = [weakBackend](std::function<void()> task) {
    if (auto backend = weakBackend.lock()) {
      backend->runOnUiThread(std::move(task));
    }
  };
  host.isUiThread = [weakBackend] {
    auto backend = weakBackend.lock();
    return backend && backend->onUiThread();
  };
  host.now = nowMs;
  host.frames.onWanted = [weakBackend](bool) {
    // Read again on the UI thread: a start and a stop from two threads may arrive in either order.
    if (auto backend = weakBackend.lock()) {
      backend->runOnUiThread(updateAnimationFrames);
    }
  };
  std::weak_ptr<MountingManager> weak = mounting;
  host.synchronouslyUpdateView = [weak](Tag tag, const folly::dynamic &props) {
    if (auto mounting = weak.lock()) {
      mounting->synchronouslyUpdateViewOnUIThread(tag, props);
    }
  };
  host.readMountedProps = [weak](Tag tag) -> facebook::react::Props::Shared {
    auto mounting = weak.lock();
    const auto *node = mounting ? mounting->tree().find(tag) : nullptr;
    return node ? node->view.props : nullptr;
  };
}

} // namespace ngn::gtk
