#include "clock-format.h"

#include "ngn/native-controls.h"

#include <cstring>
#include <string>

namespace ngn::gtk {

namespace {

constexpr const char *kNamespace = "org.gnome.desktop.interface";
constexpr const char *kKey = "clock-format";

// The string inside a portal value, which ReadOne gives as is and the older Read wraps in another
// variant.
std::string portalString(GVariant *value) {
  GVariant *inner = value ? g_variant_ref(value) : nullptr;
  while (inner && g_variant_is_of_type(inner, G_VARIANT_TYPE_VARIANT)) {
    GVariant *next = g_variant_get_variant(inner);
    g_variant_unref(inner);
    inner = next;
  }
  std::string out = inner && g_variant_is_of_type(inner, G_VARIANT_TYPE_STRING) ? g_variant_get_string(inner, nullptr) : "";
  if (inner) {
    g_variant_unref(inner);
  }
  return out;
}

} // namespace

ClockFormatWatcher::ClockFormatWatcher(std::function<void(std::optional<bool>)> changed, GDBusConnection *connection)
    : changed_(std::move(changed)), cancellable_(g_cancellable_new()) {
  if (connection) {
    start(connection);
    return;
  }
  g_bus_get(
      G_BUS_TYPE_SESSION, cancellable_,
      +[](GObject *, GAsyncResult *result, gpointer data) {
        GDBusConnection *bus = g_bus_get_finish(result, nullptr);
        if (!bus) {
          // Cancelled, or no session bus at all.
          return;
        }
        static_cast<ClockFormatWatcher *>(data)->start(bus);
        g_object_unref(bus);
      },
      this);
}

ClockFormatWatcher::~ClockFormatWatcher() {
  // Replies still on their way find nothing to call.
  g_cancellable_cancel(cancellable_);
  g_clear_object(&cancellable_);
  if (subscription_) {
    g_dbus_connection_signal_unsubscribe(connection_, subscription_);
  }
  g_clear_object(&connection_);
  if (settings_) {
    g_signal_handlers_disconnect_by_data(settings_, this);
    g_clear_object(&settings_);
  }
}

void ClockFormatWatcher::start(GDBusConnection *connection) {
  connection_ = G_DBUS_CONNECTION(g_object_ref(connection));
  subscription_ = g_dbus_connection_signal_subscribe(
      connection_, nullptr, "org.freedesktop.portal.Settings", "SettingChanged", "/org/freedesktop/portal/desktop", kNamespace,
      G_DBUS_SIGNAL_FLAGS_NONE,
      +[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *params, gpointer data) {
        const char *ns = nullptr;
        const char *key = nullptr;
        GVariant *value = nullptr;
        if (!g_variant_is_of_type(params, G_VARIANT_TYPE("(ssv)"))) {
          return;
        }
        g_variant_get(params, "(&s&sv)", &ns, &key, &value);
        if (std::strcmp(key, kKey) == 0) {
          static_cast<ClockFormatWatcher *>(data)->readValue(value);
        }
        g_variant_unref(value);
      },
      this, nullptr);
  read("ReadOne");
}

void ClockFormatWatcher::read(const char *method) {
  // ReadOne where the portal has it (version 2), Read on an older one, GSettings with no portal.
  g_dbus_connection_call(
      connection_, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Settings", method,
      g_variant_new("(ss)", kNamespace, kKey), nullptr, G_DBUS_CALL_FLAGS_NONE, -1, cancellable_,
      +[](GObject *connection, GAsyncResult *result, gpointer data) {
        GError *error = nullptr;
        GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(connection), result, &error);
        if (!reply) {
          bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
          bool readOne = g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD) && std::strstr(error->message, "ReadOne");
          g_error_free(error);
          if (cancelled) {
            return;
          }
          auto *self = static_cast<ClockFormatWatcher *>(data);
          if (readOne) {
            self->read("Read");
          } else {
            self->readGSettings();
          }
          return;
        }
        GVariant *value = g_variant_get_child_value(reply, 0);
        static_cast<ClockFormatWatcher *>(data)->readValue(value);
        g_variant_unref(value);
        g_variant_unref(reply);
      },
      this);
}

void ClockFormatWatcher::readValue(GVariant *value) {
  changed_(clockFormatTwelveHour(portalString(value)));
}

void ClockFormatWatcher::readGSettings() {
  GSettingsSchemaSource *source = g_settings_schema_source_get_default();
  GSettingsSchema *schema = source ? g_settings_schema_source_lookup(source, kNamespace, TRUE) : nullptr;
  bool has = schema && g_settings_schema_has_key(schema, kKey);
  if (schema) {
    g_settings_schema_unref(schema);
  }
  if (!has) {
    changed_(std::nullopt);
    return;
  }
  settings_ = g_settings_new(kNamespace);
  auto read = +[](GSettings *settings, const gchar *, gpointer data) {
    gchar *format = g_settings_get_string(settings, kKey);
    static_cast<ClockFormatWatcher *>(data)->changed_(clockFormatTwelveHour(format));
    g_free(format);
  };
  g_signal_connect(settings_, "changed::clock-format", G_CALLBACK(read), this);
  read(settings_, kKey, this);
}

} // namespace ngn::gtk
