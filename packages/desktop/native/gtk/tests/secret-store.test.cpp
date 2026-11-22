// SecureStore on GTK: whether a Secret Service is there to keep secrets, read from a stand-in bus,
// and a round trip through the real one when the session bus has one (GNOME Keyring under
// dbus-run-session; CI's GTK tests run with no session bus, and skip it).
#include "../secret-store.h"
#include "mounted-views.h"
#include "stand-in-portal.h"

#include <doctest/doctest.h>

#include <string>
#include <vector>

namespace {

const char *kBusIntrospection = R"(<node>
  <interface name="org.freedesktop.DBus">
    <method name="ListNames"><arg type="as" direction="out"/></method>
    <method name="ListActivatableNames"><arg type="as" direction="out"/></method>
  </interface>
</node>)";

// A message bus that answers its name lists: `running` and `activatable`.
struct StandInBus {
  GDBusConnection *server{nullptr};
  GDBusConnection *client{nullptr};
  GDBusNodeInfo *node{nullptr};
  guint registration{0};
  std::vector<std::string> running;
  std::vector<std::string> activatable;

  StandInBus() {
    std::tie(server, client) = ngn::testing::peerToPeer();
    node = g_dbus_node_info_new_for_xml(kBusIntrospection, nullptr);
    static const GDBusInterfaceVTable vtable{+[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method,
                                                GVariant *, GDBusMethodInvocation *invocation, gpointer data) {
      auto *bus = static_cast<StandInBus *>(data);
      const auto &names = g_str_equal(method, "ListNames") ? bus->running : bus->activatable;
      GVariantBuilder list;
      g_variant_builder_init(&list, G_VARIANT_TYPE("as"));
      for (const auto &name : names) {
        g_variant_builder_add(&list, "s", name.c_str());
      }
      g_dbus_method_invocation_return_value(invocation, g_variant_new("(as)", &list));
    }};
    registration = g_dbus_connection_register_object(server, "/org/freedesktop/DBus", node->interfaces[0], &vtable, this, nullptr, nullptr);
  }

  ~StandInBus() {
    g_dbus_connection_unregister_object(server, registration);
    g_dbus_node_info_unref(node);
    g_dbus_connection_close_sync(client, nullptr, nullptr);
    g_object_unref(client);
    g_object_unref(server);
  }

  // Asked from another thread: the stand-in answers on this one's main context.
  bool secretServiceOn() {
    std::optional<bool> on;
    GThread *asking = g_thread_new("ask", +[](gpointer data) -> gpointer {
      auto *self = static_cast<std::pair<StandInBus *, std::optional<bool> *> *>(data);
      *self->second = ngn::gtk::secretServiceOn(self->first->client);
      return nullptr;
    }, new std::pair<StandInBus *, std::optional<bool> *>(this, &on));
    ngn::testing::runUntil([&on] { return on.has_value(); });
    g_thread_join(asking);
    return *on;
  }
};

} // namespace

TEST_CASE("a secret's label, which the keyring's app shows, names the app and the key, and a service of its own") {
  // The default service is the app's id: named once, not twice.
  CHECK(ngn::gtk::secretLabel("dev.example.Notes", "dev.example.Notes", "api-token") == "dev.example.Notes api-token");
  CHECK(ngn::gtk::secretLabel("dev.example.Notes", "sync", "api-token") == "dev.example.Notes sync api-token");
  CHECK(ngn::gtk::secretLabel("dev.example.Notes", "", "api-token") == "dev.example.Notes api-token");
}

TEST_CASE("SecureStore has a store only where a Secret Service runs or can be started") {
  StandInBus bus;
  bus.running = {"org.freedesktop.DBus", "org.a11y.Bus"};
  bus.activatable = {"org.freedesktop.portal.Desktop"};
  CHECK_FALSE(bus.secretServiceOn());
  bus.activatable.push_back("org.freedesktop.secrets");
  CHECK(bus.secretServiceOn());
  bus.activatable.pop_back();
  bus.running.push_back("org.freedesktop.secrets");
  CHECK(bus.secretServiceOn());
  // No session bus at all.
  CHECK_FALSE(ngn::gtk::secretServiceOn(nullptr));
}

TEST_CASE("SecureStore keeps, reads, replaces and deletes a secret in the session's Secret Service") {
  auto store = ngn::gtk::makeSecretStore("dev.angularnative.secret-store-test", false);
  if (!store) {
    MESSAGE("no Secret Service on the session bus: skipped");
    return;
  }
  CHECK_FALSE(store->get("tests", "token").has_value());
  store->set("tests", "token", "first");
  CHECK(store->get("tests", "token") == "first");
  store->set("tests", "token", "second");
  CHECK(store->get("tests", "token") == "second");
  // Another service's item of the same key is its own.
  CHECK_FALSE(store->get("other", "token").has_value());
  store->remove("tests", "token");
  CHECK_FALSE(store->get("tests", "token").has_value());
}
