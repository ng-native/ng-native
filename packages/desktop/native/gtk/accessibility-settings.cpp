#include "accessibility-settings.h"

#include <adwaita.h>
#include <gtk/gtk.h>

#include <cstring>
#include <memory>

namespace ngn::gtk {

namespace {

// An int or enum GtkSettings property newer than the floor, or `fallback` where GTK lacks it.
int settingOr(GtkSettings *settings, const char *name, int fallback) {
  GParamSpec *spec = g_object_class_find_property(G_OBJECT_GET_CLASS(settings), name);
  if (!spec) {
    return fallback;
  }
  GValue value = G_VALUE_INIT;
  g_value_init(&value, spec->value_type);
  g_object_get_property(G_OBJECT(settings), name, &value);
  int out = G_VALUE_HOLDS_ENUM(&value) ? g_value_get_enum(&value) : G_VALUE_HOLDS_INT(&value) ? g_value_get_int(&value) : fallback;
  g_value_unset(&value);
  return out;
}

// A portal value, which ReadOne gives as is and the older Read wraps in another variant.
guint32 portalNumber(GVariant *value) {
  GVariant *inner = value;
  while (inner && g_variant_is_of_type(inner, G_VARIANT_TYPE_VARIANT)) {
    inner = g_variant_get_variant(inner);
  }
  guint32 n = inner && g_variant_is_of_type(inner, G_VARIANT_TYPE_UINT32) ? g_variant_get_uint32(inner) : 0;
  if (inner && inner != value) {
    g_variant_unref(inner);
  }
  return n;
}

} // namespace

bool gtkWantsMoreContrast(int interfaceContrast) {
  // GtkInterfaceContrast: 0 unsupported, 1 no preference, 2 more, 3 less. The property reads 0 on
  // a GTK without it, and 1 where nothing is asked for.
  return interfaceContrast == 2;
}

AccessibilitySettingsWatcher::AccessibilitySettingsWatcher(std::function<void(const AccessibilitySettings &)> changed, GDBusConnection *connection)
    : changed_(std::move(changed)), cancellable_(g_cancellable_new()) {
  GtkSettings *settings = gtk_settings_get_default();
  for (const char *name : {"notify::gtk-enable-animations", "notify::gtk-interface-reduced-motion", "notify::gtk-interface-contrast"}) {
    if (settings && g_object_class_find_property(G_OBJECT_GET_CLASS(settings), strchr(name, ':') + 2)) {
      g_signal_connect_swapped(settings, name, G_CALLBACK(+[](AccessibilitySettingsWatcher *self) {
        self->readGtk();
        self->report();
      }), this);
    }
  }
  g_signal_connect_swapped(adw_style_manager_get_default(), "notify::high-contrast", G_CALLBACK(+[](AccessibilitySettingsWatcher *self) {
    self->readGtk();
    self->report();
  }), this);
  readGtk();
  report();

  // The session bus, or the connection a test gives in its place.
  auto proxyOn = [connection](GDBusProxyFlags flags, const char *name, const char *path, const char *interface, GCancellable *cancellable,
                              GAsyncReadyCallback ready, gpointer data) {
    if (connection) {
      g_dbus_proxy_new(connection, flags, nullptr, name, path, interface, cancellable, ready, data);
    } else {
      g_dbus_proxy_new_for_bus(G_BUS_TYPE_SESSION, flags, nullptr, name, path, interface, cancellable, ready, data);
    }
  };

  // The settings portal's reduced-motion, read once it answers and followed as it changes.
  proxyOn(
      G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES, "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Settings", cancellable_,
      +[](GObject *, GAsyncResult *result, gpointer data) {
        GDBusProxy *proxy = g_dbus_proxy_new_finish(result, nullptr);
        if (!proxy) {
          return;
        }
        auto *self = static_cast<AccessibilitySettingsWatcher *>(data);
        self->portal_ = proxy;
        // A portal that restarts need not say its value again: read it as a new owner appears, and
        // let go of the old one's as it goes.
        g_signal_connect_swapped(proxy, "notify::g-name-owner", G_CALLBACK(+[](AccessibilitySettingsWatcher *self) {
          self->portalOwnerChanged();
        }), self);
        auto changed = +[](AccessibilitySettingsWatcher *self, const char *, const char *signal, GVariant *params) {
          const char *ns = nullptr;
          const char *key = nullptr;
          GVariant *value = nullptr;
          if (std::strcmp(signal, "SettingChanged") == 0 && g_variant_is_of_type(params, G_VARIANT_TYPE("(ssv)"))) {
            g_variant_get(params, "(&s&sv)", &ns, &key, &value);
            if (std::strcmp(ns, "org.freedesktop.appearance") == 0 && std::strcmp(key, "reduced-motion") == 0) {
              self->readPortal(value);
            }
            g_variant_unref(value);
          }
        };
        g_signal_connect_swapped(proxy, "g-signal", G_CALLBACK(changed), self);
        self->readPortalSetting(false);
      },
      this);

  // AT-SPI's own status, which says whether a screen reader runs.
  proxyOn(
      G_DBUS_PROXY_FLAGS_NONE, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Status", cancellable_,
      +[](GObject *, GAsyncResult *result, gpointer data) {
        GDBusProxy *proxy = g_dbus_proxy_new_finish(result, nullptr);
        if (!proxy) {
          return;
        }
        auto *self = static_cast<AccessibilitySettingsWatcher *>(data);
        self->status_ = proxy;
        g_signal_connect_swapped(proxy, "g-properties-changed", G_CALLBACK(+[](AccessibilitySettingsWatcher *self) {
          self->readStatus();
        }), self);
        self->readStatus();
      },
      this);
}

AccessibilitySettingsWatcher::~AccessibilitySettingsWatcher() {
  // Replies still on their way find nothing to call.
  g_cancellable_cancel(cancellable_);
  g_clear_object(&cancellable_);
  if (GtkSettings *settings = gtk_settings_get_default()) {
    g_signal_handlers_disconnect_by_data(settings, this);
  }
  g_signal_handlers_disconnect_by_data(adw_style_manager_get_default(), this);
  if (portal_) {
    g_signal_handlers_disconnect_by_data(portal_, this);
    g_clear_object(&portal_);
  }
  if (status_) {
    g_signal_handlers_disconnect_by_data(status_, this);
    g_clear_object(&status_);
  }
}

void AccessibilitySettingsWatcher::readGtk() {
  GtkSettings *settings = gtk_settings_get_default();
  if (settings) {
    gboolean animations = TRUE;
    g_object_get(settings, "gtk-enable-animations", &animations, nullptr);
    sources_.animations = animations;
    // GtkReducedMotion: 0 no preference, 1 reduce. GtkInterfaceContrast: 0 no preference, 1 more.
    sources_.gtkReducedMotion = settingOr(settings, "gtk-interface-reduced-motion", 0) == 1;
  }
  bool gtkContrast = settings && gtkWantsMoreContrast(settingOr(settings, "gtk-interface-contrast", 0));
  sources_.highContrast = adw_style_manager_get_high_contrast(adw_style_manager_get_default()) || gtkContrast;
}

void AccessibilitySettingsWatcher::portalOwnerChanged() {
  // Replies asked of the last owner are no longer this one's to give.
  portalRead_++;
  char *owner = g_dbus_proxy_get_name_owner(portal_);
  if (owner) {
    g_free(owner);
    readPortalSetting(false);
    return;
  }
  sources_.portalReducedMotion = false;
  report();
}

namespace {

// A read of the portal's setting, for the owner it was asked of.
struct PortalRead {
  AccessibilitySettingsWatcher *self;
  unsigned generation;
  bool legacy;
};

} // namespace

void AccessibilitySettingsWatcher::readPortalSetting(bool legacy) {
  // ReadOne where the portal has it (version 2), Read on an older one.
  g_dbus_proxy_call(
      portal_, legacy ? "Read" : "ReadOne", g_variant_new("(ss)", "org.freedesktop.appearance", "reduced-motion"),
      G_DBUS_CALL_FLAGS_NONE, -1, cancellable_,
      +[](GObject *proxy, GAsyncResult *result, gpointer data) {
        std::unique_ptr<PortalRead> read(static_cast<PortalRead *>(data));
        GError *error = nullptr;
        GVariant *reply = g_dbus_proxy_call_finish(G_DBUS_PROXY(proxy), result, &error);
        if (!reply) {
          bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
          bool unknown = g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD);
          g_error_free(error);
          // Only ReadOne's missing method asks the older Read: if that fails too, the portal has no
          // such setting, and the source stays off.
          if (!cancelled && unknown && !read->legacy && read->generation == read->self->portalRead_) {
            read->self->readPortalSetting(true);
          }
          return;
        }
        if (read->generation == read->self->portalRead_) {
          GVariant *value = g_variant_get_child_value(reply, 0);
          read->self->readPortal(value);
          g_variant_unref(value);
        }
        g_variant_unref(reply);
      },
      new PortalRead{this, portalRead_, legacy});
}

void AccessibilitySettingsWatcher::readPortal(GVariant *value) {
  sources_.portalReducedMotion = portalNumber(value) == 1;
  report();
}

void AccessibilitySettingsWatcher::readStatus() {
  GVariant *enabled = status_ ? g_dbus_proxy_get_cached_property(status_, "ScreenReaderEnabled") : nullptr;
  sources_.screenReader = enabled && g_variant_is_of_type(enabled, G_VARIANT_TYPE_BOOLEAN) && g_variant_get_boolean(enabled);
  if (enabled) {
    g_variant_unref(enabled);
  }
  report();
}

void AccessibilitySettingsWatcher::report() {
  auto settings = linuxAccessibility(sources_);
  if (reported_ != settings) {
    reported_ = settings;
    changed_(settings);
  }
}

WatchedHostState makeWatchedHostState() {
  WatchedHostState made;
  made.state = std::make_shared<HostState>();
  // Heard at start, so the state is made before the watcher.
  made.accessibility = std::make_unique<AccessibilitySettingsWatcher>([state = made.state](const AccessibilitySettings &settings) { state->accessibility.set(settings); });
  return made;
}

} // namespace ngn::gtk
