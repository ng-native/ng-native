// GNOME's clock format on GTK (clock-format.h): the settings portal's clock-format, read with
// ReadOne or an older portal's Read and followed as it changes, against a portal of the test's own
// on a peer-to-peer connection.
#include "mounted-views.h"

#include "../clock-format.h"

#include <doctest/doctest.h>
#include <gio/gio.h>

#include <sys/socket.h>

#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace {

const char *kSettings = R"(<node>
  <interface name="org.freedesktop.portal.Settings">
    <method name="ReadOne"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <method name="Read"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <signal name="SettingChanged"><arg type="s"/><arg type="s"/><arg type="v"/></signal>
  </interface>
</node>)";

// The settings portal: a clock-format, if any, and whether it is version 1, with no ReadOne and a
// Read that wraps the value in a second variant.
struct SettingsPortal {
  GDBusConnection *server{nullptr};
  GDBusConnection *client{nullptr};
  GDBusNodeInfo *node{nullptr};
  guint registration{0};
  std::optional<std::string> clockFormat;
  bool version1{false};
  std::vector<std::string> methods;

  SettingsPortal() {
    REQUIRE(ngn::testing::gtkReady());
    int fds[2];
    REQUIRE(socketpair(AF_UNIX, SOCK_STREAM, 0, fds) == 0);
    auto stream = [](int fd) {
      GSocket *socket = g_socket_new_from_fd(fd, nullptr);
      auto *connection = G_IO_STREAM(g_socket_connection_factory_create_connection(socket));
      g_object_unref(socket);
      return connection;
    };
    GIOStream *serverStream = stream(fds[0]);
    GIOStream *clientStream = stream(fds[1]);
    gchar *guid = g_dbus_generate_guid();
    auto made = +[](GObject *, GAsyncResult *result, gpointer out) {
      *static_cast<GDBusConnection **>(out) = g_dbus_connection_new_finish(result, nullptr);
    };
    g_dbus_connection_new(serverStream, guid,
                          GDBusConnectionFlags(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_SERVER | G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_ALLOW_ANONYMOUS),
                          nullptr, nullptr, made, &server);
    g_dbus_connection_new(clientStream, nullptr, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT, nullptr, nullptr, made, &client);
    ngn::testing::runUntil([&] { return server && client; });
    g_free(guid);
    g_object_unref(serverStream);
    g_object_unref(clientStream);
    node = g_dbus_node_info_new_for_xml(kSettings, nullptr);
    static const GDBusInterfaceVTable vtable{+[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method,
                                                GVariant *parameters, GDBusMethodInvocation *invocation, gpointer data) {
      static_cast<SettingsPortal *>(data)->read(method, parameters, invocation);
    }};
    registration = g_dbus_connection_register_object(server, "/org/freedesktop/portal/desktop", node->interfaces[0], &vtable, this, nullptr, nullptr);
  }

  ~SettingsPortal() {
    g_dbus_connection_unregister_object(server, registration);
    g_dbus_node_info_unref(node);
    g_dbus_connection_close_sync(client, nullptr, nullptr);
    g_object_unref(client);
    g_object_unref(server);
  }

  void read(const std::string &method, GVariant *parameters, GDBusMethodInvocation *invocation) {
    methods.push_back(method);
    if (method == "ReadOne" && version1) {
      g_dbus_method_invocation_return_error(invocation, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD, "No such method ReadOne");
      return;
    }
    const gchar *ns = nullptr;
    const gchar *key = nullptr;
    g_variant_get(parameters, "(&s&s)", &ns, &key);
    if (!clockFormat || std::string(ns) != "org.gnome.desktop.interface" || std::string(key) != "clock-format") {
      g_dbus_method_invocation_return_dbus_error(invocation, "org.freedesktop.portal.Error.NotFound", "Requested setting not found");
      return;
    }
    GVariant *value = g_variant_new_string(clockFormat->c_str());
    if (method == "Read") {
      value = g_variant_new_variant(value);
    }
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(v)", value));
  }

  void change(const std::string &format) {
    clockFormat = format;
    g_dbus_connection_emit_signal(server, nullptr, "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Settings", "SettingChanged",
                                  g_variant_new("(ssv)", "org.gnome.desktop.interface", "clock-format", g_variant_new_string(format.c_str())),
                                  nullptr);
  }
};

} // namespace

TEST_CASE("the clock format is the settings portal's clock-format, followed as it changes") {
  SettingsPortal portal;
  portal.clockFormat = "12h";
  std::vector<std::optional<bool>> heard;
  ngn::gtk::ClockFormatWatcher watcher([&heard](std::optional<bool> twelve) { heard.push_back(twelve); }, portal.client);
  ngn::testing::runUntil([&] { return !heard.empty(); });
  CHECK(heard.back() == std::optional<bool>(true));
  CHECK(portal.methods == std::vector<std::string>{"ReadOne"});
  portal.change("24h");
  ngn::testing::runUntil([&] { return heard.size() == 2; });
  CHECK(heard.back() == std::optional<bool>(false));
  // A value that is neither leaves it to the locale.
  portal.change("12-hour");
  ngn::testing::runUntil([&] { return heard.size() == 3; });
  CHECK_FALSE(heard.back());
}

TEST_CASE("an older settings portal's Read gives the clock format, and nothing heard once the watcher has gone") {
  SettingsPortal portal;
  portal.clockFormat = "24h";
  portal.version1 = true;
  std::vector<std::optional<bool>> heard;
  {
    ngn::gtk::ClockFormatWatcher watcher([&heard](std::optional<bool> twelve) { heard.push_back(twelve); }, portal.client);
    ngn::testing::runUntil([&] { return !heard.empty(); });
    CHECK(heard.back() == std::optional<bool>(false));
    CHECK(portal.methods == std::vector<std::string>{"ReadOne", "Read"});
  }
  portal.change("12h");
  for (int i = 0; i < 50; ++i) {
    g_main_context_iteration(nullptr, FALSE);
  }
  CHECK(heard.size() == 1);
}

TEST_CASE("with no clock-format in the portal, GSettings' gives the clock format where its schema is installed") {
  SettingsPortal portal;
  g_setenv("GSETTINGS_BACKEND", "memory", TRUE);
  GSettingsSchemaSource *source = g_settings_schema_source_get_default();
  GSettingsSchema *schema = source ? g_settings_schema_source_lookup(source, "org.gnome.desktop.interface", TRUE) : nullptr;
  bool installed = schema && g_settings_schema_has_key(schema, "clock-format");
  if (schema) {
    g_settings_schema_unref(schema);
  }
  std::vector<std::optional<bool>> heard;
  ngn::gtk::ClockFormatWatcher watcher([&heard](std::optional<bool> twelve) { heard.push_back(twelve); }, portal.client);
  ngn::testing::runUntil([&] { return !heard.empty(); });
  if (!installed) {
    CHECK_FALSE(heard.back());
    g_unsetenv("GSETTINGS_BACKEND");
    return;
  }
  // The memory backend starts at the schema's default, 24h.
  CHECK(heard.back() == std::optional<bool>(false));
  GSettings *settings = g_settings_new("org.gnome.desktop.interface");
  g_settings_set_string(settings, "clock-format", "12h");
  ngn::testing::runUntil([&] { return heard.size() == 2; });
  CHECK(heard.back() == std::optional<bool>(true));
  g_settings_reset(settings, "clock-format");
  g_object_unref(settings);
  g_unsetenv("GSETTINGS_BACKEND");
}

TEST_CASE("with no session bus at all, GSettings' clock format is still looked up") {
  REQUIRE(ngn::testing::gtkReady());
  const char *had = g_getenv("DBUS_SESSION_BUS_ADDRESS");
  std::string saved = had ? had : "";
  g_setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/ngn-no-bus", TRUE);
  g_setenv("GSETTINGS_BACKEND", "memory", TRUE);
  std::vector<std::optional<bool>> heard;
  {
    ngn::gtk::ClockFormatWatcher watcher([&heard](std::optional<bool> twelve) { heard.push_back(twelve); });
    // Heard whether or not the schema is installed: no clock format, or the schema's default.
    ngn::testing::runUntil([&] { return !heard.empty(); });
    CHECK(heard.size() == 1);
  }
  g_unsetenv("GSETTINGS_BACKEND");
  if (had) {
    g_setenv("DBUS_SESSION_BUS_ADDRESS", saved.c_str(), TRUE);
  } else {
    g_unsetenv("DBUS_SESSION_BUS_ADDRESS");
  }
}
