#include "window-scale.h"

#include <dlfcn.h>

#include <optional>

namespace ngn::gtk {

namespace {

GdkSurface *surfaceOf(GtkWidget *widget) {
  GtkNative *native = widget ? gtk_widget_get_native(widget) : nullptr;
  return native ? gtk_native_get_surface(native) : nullptr;
}

// The monitor's scale: fractional from GTK 4.14, found at run time, else its whole number. Nothing
// without a monitor.
std::optional<double> monitorScale(GdkDisplay *display, GdkSurface *surface) {
  using GetScale = double (*)(GdkMonitor *);
  static auto getScale = reinterpret_cast<GetScale>(dlsym(RTLD_DEFAULT, "gdk_monitor_get_scale"));
  GdkMonitor *monitor = surface ? gdk_display_get_monitor_at_surface(display, surface) : nullptr;
  GdkMonitor *first = nullptr;
  if (!monitor) {
    GListModel *monitors = gdk_display_get_monitors(display);
    first = g_list_model_get_n_items(monitors) > 0 ? GDK_MONITOR(g_list_model_get_item(monitors, 0)) : nullptr;
    monitor = first;
  }
  std::optional<double> scale;
  if (monitor) {
    scale = getScale ? getScale(monitor) : gdk_monitor_get_scale_factor(monitor);
  }
  if (first) {
    g_object_unref(first);
  }
  return scale;
}

} // namespace

double windowScale(GtkWidget *widget) {
  using GetScale = double (*)(GdkSurface *);
  static auto getScale = reinterpret_cast<GetScale>(dlsym(RTLD_DEFAULT, "gdk_surface_get_scale"));
  GdkSurface *surface = surfaceOf(widget);
  if (surface && gdk_surface_get_mapped(surface)) {
    return getScale ? getScale(surface) : gdk_surface_get_scale_factor(surface);
  }
  // Not shown yet: a Wayland surface learns its fractional scale only once it shows, and until then
  // GDK rounds it up, so its monitor's scale stands in, as macOS gives a window off screen its
  // screen's.
  GdkDisplay *display = widget ? gtk_widget_get_display(widget) : gdk_display_get_default();
  if (auto scale = display ? monitorScale(display, surface) : std::nullopt) {
    return *scale;
  }
  return surface ? gdk_surface_get_scale_factor(surface) : 1;
}

void followWindowScale(GtkWidget *window, std::function<void()> changed) {
  GdkSurface *surface = surfaceOf(window);
  if (!surface) {
    return;
  }
  // `scale` from GTK 4.12: it changes with every step `scale-factor` takes, and with fractional ones.
  bool fractional = g_object_class_find_property(G_OBJECT_GET_CLASS(surface), "scale") != nullptr;
  g_signal_connect_data(
      surface, fractional ? "notify::scale" : "notify::scale-factor",
      G_CALLBACK(+[](GdkSurface *, GParamSpec *, gpointer data) { (*static_cast<std::function<void()> *>(data))(); }),
      new std::function<void()>(std::move(changed)), [](gpointer data, GClosure *) { delete static_cast<std::function<void()> *>(data); },
      GConnectFlags(0));
}

} // namespace ngn::gtk
