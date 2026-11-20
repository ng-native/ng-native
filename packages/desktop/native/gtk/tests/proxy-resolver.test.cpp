// The desktop's proxy settings on GTK (proxy-resolver.h): the proxy portal first, here a stand-in
// reached over a peer-to-peer D-Bus connection (no bus daemon), else GLib's resolver.
#include "../proxy-resolver.h"

#include <doctest/doctest.h>
#include <glib/gstdio.h>

#include <atomic>
#include <string>
#include <thread>
#include <vector>

namespace {

const char *kPortalXml = R"(<node>
  <interface name="org.freedesktop.portal.ProxyResolver">
    <method name="Lookup"><arg type="s" name="uri" direction="in"/><arg type="as" name="proxies" direction="out"/></method>
  </interface>
</node>)";

void lookUp(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *parameters,
            GDBusMethodInvocation *invocation, gpointer) {
  const gchar *uri = nullptr;
  g_variant_get(parameters, "(&s)", &uri);
  std::string answer = std::string("http://portal-proxy:3128/") + uri;
  const gchar *list[] = {answer.c_str(), "direct://", nullptr};
  g_dbus_method_invocation_return_value(invocation, g_variant_new("(^as)", list));
}

const GDBusInterfaceVTable kVtable = {lookUp, nullptr, nullptr, {}};

gboolean accept(GDBusServer *, GDBusConnection *connection, gpointer) {
  // Kept until the process ends, as the server hands over no reference.
  g_object_ref(connection);
  return TRUE;
}

gboolean acceptWithPortal(GDBusServer *server, GDBusConnection *connection, gpointer data) {
  auto *node = static_cast<GDBusNodeInfo *>(data);
  g_dbus_connection_register_object(connection, "/org/freedesktop/portal/desktop", node->interfaces[0], &kVtable, nullptr, nullptr, nullptr);
  return accept(server, connection, data);
}

// A D-Bus server on a thread and main context of its own. With `portal`, each connection to it has
// a proxy portal object, answering a lookup with `http://portal-proxy:3128/<url>` then `direct://`;
// without, it has no objects, as a session without the portal.
struct StandIn {
  std::thread thread;
  GMainLoop *loop{nullptr};
  std::string address;
  std::atomic<bool> ready{false};

  explicit StandIn(bool portal) {
    thread = std::thread([this, portal] {
      GMainContext *context = g_main_context_new();
      g_main_context_push_thread_default(context);
      loop = g_main_loop_new(context, FALSE);
      gchar *guid = g_dbus_generate_guid();
      gchar *dir = g_dir_make_tmp("ngn-dbus-XXXXXX", nullptr);
      std::string listen = std::string("unix:tmpdir=") + dir;
      GDBusServer *server = g_dbus_server_new_sync(listen.c_str(), G_DBUS_SERVER_FLAGS_NONE, guid, nullptr, nullptr, nullptr);
      GDBusNodeInfo *info = g_dbus_node_info_new_for_xml(kPortalXml, nullptr);
      g_signal_connect(server, "new-connection", G_CALLBACK(portal ? +acceptWithPortal : +accept), info);
      g_dbus_server_start(server);
      address = g_dbus_server_get_client_address(server);
      ready = true;
      g_main_loop_run(loop);
      g_dbus_server_stop(server);
      g_object_unref(server);
      g_dbus_node_info_unref(info);
      g_remove(dir);
      g_free(dir);
      g_free(guid);
      g_main_loop_unref(loop);
      g_main_context_pop_thread_default(context);
      g_main_context_unref(context);
    });
    while (!ready) {
      std::this_thread::yield();
    }
  }

  ~StandIn() {
    g_main_loop_quit(loop);
    thread.join();
  }

  GDBusConnection *connect() const {
    return g_dbus_connection_new_for_address_sync(address.c_str(), G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT, nullptr, nullptr, nullptr);
  }
};

} // namespace

TEST_CASE("the desktop's proxies come from the proxy portal when one answers, else from GLib's resolver") {
  const gchar *ignore[] = {nullptr};
  GProxyResolver *fallback = g_simple_proxy_resolver_new("http://glib-proxy:8080", const_cast<gchar **>(ignore));
  GDBusConnection *withPortal = nullptr;
  GDBusConnection *without = nullptr;
  try {
    StandIn portal(true);
    StandIn none(false);
    withPortal = portal.connect();
    without = none.connect();
    REQUIRE(withPortal);
    REQUIRE(without);
    CHECK(ngn::gtk::desktopProxies("https://example.com/", withPortal, fallback) ==
          std::vector<std::string>{"http://portal-proxy:3128/https://example.com/", "direct://"});
    // No portal answers: GLib's resolver.
    CHECK(ngn::gtk::desktopProxies("https://example.com/", without, fallback) == std::vector<std::string>{"http://glib-proxy:8080"});
    CHECK(ngn::gtk::desktopProxies("http://example.com/", nullptr, fallback) == std::vector<std::string>{"http://glib-proxy:8080"});
    CHECK(ngn::gtk::desktopProxies("http://example.com/", nullptr, nullptr).empty());
    g_dbus_connection_close_sync(withPortal, nullptr, nullptr);
    g_dbus_connection_close_sync(without, nullptr, nullptr);
  } catch (...) {
    g_clear_object(&withPortal);
    g_clear_object(&without);
    g_object_unref(fallback);
    throw;
  }
  g_clear_object(&withPortal);
  g_clear_object(&without);
  g_object_unref(fallback);
}
