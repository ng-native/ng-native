// Notifications on GTK: shown through a stand-in Notification portal, or through GNotification to
// a stand-in org.gtk.Notifications on the session bus where no portal answers; a click as the
// response the app hears; and what came due while the app was closed shown on the next launch.
#include "../app-windows.h"
#include "../notifications.h"
#include "mounted-views.h"
#include "stand-in-portal.h"

#include <doctest/doctest.h>

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

using ngn::testing::StandInPortal;

namespace {

struct Folder {
  std::string path;
  Folder() {
    char name[] = "/tmp/ngn-gtk-notifications-XXXXXX";
    REQUIRE(mkdtemp(name) != nullptr);
    path = name;
  }
  ~Folder() {
    std::filesystem::remove_all(path);
  }
};

ngn::NotificationRequest request(const std::string &id, ngn::NotificationTrigger trigger = {}) {
  ngn::NotificationRequest out;
  out.identifier = id;
  out.title = "Lunch";
  out.subtitle = "Today";
  out.body = "At noon";
  out.data = folly::dynamic::object("table", 4);
  out.trigger = trigger;
  return out;
}

// The app's events, as the module would hear them.
struct Heard {
  std::vector<folly::dynamic> events;
  std::shared_ptr<void> handle;
  explicit Heard(ngn::NotificationEvents &source) {
    handle = source.listen([this](const folly::dynamic &event) { events.push_back(event); });
  }
  size_t count(const char *type) const {
    return std::count_if(events.begin(), events.end(), [type](const folly::dynamic &e) { return e["type"] == type; });
  }
};

// org.gtk.Notifications, GNOME Shell's, owned on the session bus by the test: what GNotification
// sends where it is the desktop's server.
const char *kGtkNotifications = R"(<node>
  <interface name="org.gtk.Notifications">
    <method name="AddNotification"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/></method>
    <method name="RemoveNotification"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
  </interface>
</node>)";

struct StandInShell {
  GDBusConnection *bus{nullptr};
  GDBusNodeInfo *node{nullptr};
  guint registration{0};
  guint owner{0};
  bool owned{false};
  // Method, app id, notification id, title.
  std::vector<std::vector<std::string>> calls;

  explicit StandInShell(GDBusConnection *connection) : bus(connection) {
    node = g_dbus_node_info_new_for_xml(kGtkNotifications, nullptr);
    static const GDBusInterfaceVTable vtable{+[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method,
                                                GVariant *parameters, GDBusMethodInvocation *invocation, gpointer data) {
      auto *self = static_cast<StandInShell *>(data);
      const gchar *app = nullptr, *id = nullptr;
      const gchar *title = "";
      if (std::string(method) == "AddNotification") {
        GVariant *notification = nullptr;
        g_variant_get(parameters, "(&s&s@a{sv})", &app, &id, &notification);
        g_variant_lookup(notification, "title", "&s", &title);
        self->calls.push_back({method, app, id, title});
        g_variant_unref(notification);
      } else {
        g_variant_get(parameters, "(&s&s)", &app, &id);
        self->calls.push_back({method, app, id, ""});
      }
      g_dbus_method_invocation_return_value(invocation, nullptr);
    }};
    registration = g_dbus_connection_register_object(bus, "/org/gtk/Notifications", node->interfaces[0], &vtable, this, nullptr, nullptr);
    owner = g_bus_own_name_on_connection(bus, "org.gtk.Notifications", G_BUS_NAME_OWNER_FLAGS_NONE,
                                         +[](GDBusConnection *, const gchar *, gpointer data) { static_cast<StandInShell *>(data)->owned = true; },
                                         nullptr, this, nullptr);
    ngn::testing::runUntil([this] { return owned; });
  }
  ~StandInShell() {
    g_bus_unown_name(owner);
    g_dbus_connection_unregister_object(bus, registration);
    g_dbus_node_info_unref(node);
  }
};

} // namespace

TEST_CASE("A notification shows through the Notification portal as it comes due, and a click on it is the response") {
  StandInPortal portal;
  Folder folder;
  GtkApplication *app = ngn::gtk::startApplication("dev.ngnative.NotifyTest", false);
  auto events = std::make_shared<ngn::NotificationEvents>("linux");
  Heard heard(*events);
  int raised = 0;
  auto center = ngn::gtk::makeNotificationCenter(G_APPLICATION(app), folder.path, events, [&raised] { ++raised; });
  CHECK(center->canPost());

  std::optional<std::string> error = "unanswered";
  center->add(request("lunch"), [&error](std::optional<std::string> e) { error = e; });
  CHECK_FALSE(error);
  ngn::testing::runUntil([&] { return portal.calls.size() == 1; });
  const auto &shown = portal.calls[0];
  CHECK(shown.method == "AddNotification");
  CHECK(shown.first == "lunch");
  CHECK(shown.second == "Lunch");
  CHECK(shown.body == "Today\nAt noon");
  // Outside a sandbox, a plain action, which the portal sends back rather than activating an app
  // it cannot name.
  CHECK(shown.action == "ngn-notification");
  CHECK(shown.target == "lunch");
  // AddNotification returns no Request, so it is given no handle_token.
  CHECK_FALSE(shown.token);
  CHECK(heard.count("received") == 1);
  CHECK(heard.events[0]["notification"]["request"]["content"]["data"]["table"] == 4);

  portal.invoke("lunch", "ngn-notification");
  ngn::testing::runUntil([&] { return heard.count("response") == 1; });
  CHECK(raised == 1);
  auto last = events->lastResponse();
  REQUIRE(last);
  CHECK((*last)["notification"]["request"]["identifier"] == "lunch");
  // Another action of the portal's is not a click on it.
  portal.invoke("lunch", "something-else");
  for (int i = 0; i < 20; ++i) {
    g_main_context_iteration(nullptr, FALSE);
  }
  CHECK(heard.count("response") == 1);

  // Presented until dismissed, which withdraws it from the portal.
  std::vector<std::pair<double, ngn::NotificationRequest>> presented;
  center->delivered([&presented](auto list) { presented = std::move(list); });
  REQUIRE(presented.size() == 1);
  center->removeDelivered({"lunch"});
  ngn::testing::runUntil([&] { return portal.calls.size() == 2; });
  CHECK(portal.calls[1].method == "RemoveNotification");
  CHECK(portal.calls[1].first == "lunch");
  center->delivered([&presented](auto list) { presented = std::move(list); });
  CHECK(presented.empty());

  center.reset();
  g_object_unref(app);
}

TEST_CASE("A scheduled notification waits for its time, and one due while the app was closed shows on the next launch") {
  StandInPortal portal;
  Folder folder;
  GtkApplication *app = ngn::gtk::startApplication("dev.ngnative.NotifyLater", false);
  auto events = std::make_shared<ngn::NotificationEvents>("linux");
  {
    auto center = ngn::gtk::makeNotificationCenter(G_APPLICATION(app), folder.path, events, [] {});
    center->add(request("soon", {.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 0.2}), [](auto) {});
    std::vector<ngn::NotificationRequest> scheduled;
    center->pending([&scheduled](auto list) { scheduled = std::move(list); });
    CHECK(scheduled.size() == 1);
    CHECK(center->nextDate({.kind = ngn::NotificationTrigger::Kind::Interval, .seconds = 60}) > g_get_real_time() / 1000.0 + 59'000);
  }
  // The app was closed before it came due.
  g_usleep(300'000);
  for (int i = 0; i < 20; ++i) {
    g_main_context_iteration(nullptr, FALSE);
  }
  CHECK(portal.calls.empty());
  auto center = ngn::gtk::makeNotificationCenter(G_APPLICATION(app), folder.path, events, [] {});
  ngn::testing::runUntil([&] { return portal.calls.size() == 1; });
  CHECK(portal.calls[0].first == "soon");
  std::vector<ngn::NotificationRequest> scheduled;
  center->pending([&scheduled](auto list) { scheduled = std::move(list); });
  CHECK(scheduled.empty());
  center.reset();
  g_object_unref(app);
}

TEST_CASE("Where no portal answers, GNotification shows a notification, and the app's action is its click") {
  REQUIRE(ngn::testing::gtkReady());
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  if (!bus) {
    MESSAGE("skipped: no session bus (run the tests under dbus-run-session)");
    return;
  }
  StandInPortal portal;
  portal.offersNotification = false;
  Folder folder;
  StandInShell shell(bus);
  GtkApplication *app = ngn::gtk::startApplication("dev.ngnative.NotifyFallback", false);
  auto events = std::make_shared<ngn::NotificationEvents>("linux");
  Heard heard(*events);
  int raised = 0;
  auto center = ngn::gtk::makeNotificationCenter(G_APPLICATION(app), folder.path, events, [&raised] { ++raised; });
  center->add(request("tea"), [](auto) {});
  ngn::testing::runUntil([&] { return !shell.calls.empty(); });
  CHECK(shell.calls[0] == std::vector<std::string>{"AddNotification", "dev.ngnative.NotifyFallback", "tea", "Lunch"});
  CHECK(heard.count("received") == 1);

  // GNOME Shell runs the default action on the app, as D-Bus activation does on a launch.
  g_action_group_activate_action(G_ACTION_GROUP(app), ngn::gtk::kNotificationAction, g_variant_new_string("tea"));
  ngn::testing::runUntil([&] { return heard.count("response") == 1; });
  CHECK(raised == 1);

  center->removeAllDelivered();
  ngn::testing::runUntil([&] { return shell.calls.size() == 2; });
  CHECK(shell.calls[1][0] == "RemoveNotification");
  CHECK(shell.calls[1][2] == "tea");
  center.reset();
  g_object_unref(app);
  g_object_unref(bus);
}
