// The tray as StatusNotifierItems (status-notifier.h) and the launcher badge (launcher-badge.h),
// over the session bus: a StatusNotifierWatcher stand-in owns the watcher's name and records what
// registers, and the test reads and drives each item as a host would. They need a session bus, so
// they run under dbus-run-session; CI fails them without one, and elsewhere they are skipped.
#include "../launcher-badge.h"
#include "../status-notifier.h"

#include <doctest/doctest.h>
#include <gio/gio.h>

#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

namespace {

using ngn::MenuItem;
using ngn::TrayIcon;

bool haveSessionBus() {
  bool have = g_getenv("DBUS_SESSION_BUS_ADDRESS") != nullptr;
  if (!have) {
    REQUIRE_MESSAGE(getenv("CI") == nullptr, "the tray tests need a session bus: run them under dbus-run-session");
    MESSAGE("skipped: no session bus");
  }
  return have;
}

bool spinUntil(const std::function<bool()> &done) {
  for (int i = 0; i < 400 && !done(); ++i) {
    g_main_context_iteration(nullptr, FALSE);
    g_usleep(5000);
  }
  return done();
}

void drop(GVariant *reply) {
  if (reply) {
    g_variant_unref(reply);
  }
}

void spin(int turns = 40) {
  for (int i = 0; i < turns; ++i) {
    g_main_context_iteration(nullptr, FALSE);
    g_usleep(2000);
  }
}

constexpr const char *kWatcherXml = R"(<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem"><arg name="service" type="s" direction="in"/></method>
  </interface>
</node>)";

// Owns org.kde.StatusNotifierWatcher while it lives, and records each registration as the
// sender's name and the path it gave.
struct Watcher {
  struct Registered {
    std::string sender;
    std::string path;
  };
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  GDBusNodeInfo *info = g_dbus_node_info_new_for_xml(kWatcherXml, nullptr);
  guint object = 0;
  guint name = 0;
  bool owned = false;
  std::vector<Registered> registered;

  Watcher() {
    static const GDBusInterfaceVTable vtable{
        .method_call = [](GDBusConnection *, const gchar *sender, const gchar *, const gchar *, const gchar *, GVariant *args,
                          GDBusMethodInvocation *invocation, gpointer data) {
          const gchar *path = nullptr;
          g_variant_get(args, "(&s)", &path);
          static_cast<Watcher *>(data)->registered.push_back({sender, path});
          g_dbus_method_invocation_return_value(invocation, nullptr);
        },
    };
    object = g_dbus_connection_register_object(bus, "/StatusNotifierWatcher", info->interfaces[0], &vtable, this, nullptr, nullptr);
    name = g_bus_own_name_on_connection(
        bus, ngn::gtk::kStatusNotifierWatcher, G_BUS_NAME_OWNER_FLAGS_NONE,
        [](GDBusConnection *, const gchar *, gpointer data) { static_cast<Watcher *>(data)->owned = true; }, nullptr, this, nullptr);
    spinUntil([this] { return owned; });
  }
  ~Watcher() {
    g_bus_unown_name(name);
    g_dbus_connection_unregister_object(bus, object);
    g_dbus_node_info_unref(info);
    spinUntil([] { return !ngn::gtk::statusNotifierWatcherRunning(); });
    g_object_unref(bus);
  }
  Watcher(const Watcher &) = delete;
  Watcher &operator=(const Watcher &) = delete;

  // Called as a host calls it, with the main loop turning: the item answers from it.
  GVariant *call(const Registered &at, const char *path, const char *interface, const char *method, GVariant *args) const {
    // Shared with the callback, which a late reply can run after this returns.
    struct Answer {
      bool done{false};
      GVariant *reply{nullptr};
    };
    auto answer = std::make_shared<Answer>();
    g_dbus_connection_call(
        bus, at.sender.c_str(), path, interface, method, args, nullptr, G_DBUS_CALL_FLAGS_NONE, 2000, nullptr,
        [](GObject *source, GAsyncResult *result, gpointer data) {
          auto *held = static_cast<std::shared_ptr<Answer> *>(data);
          GError *error = nullptr;
          GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
          if (error) {
            MESSAGE(std::string(error->message));
            g_error_free(error);
          }
          if ((*held)->done) {
            // The caller gave up, so nothing owns the reply.
            drop(reply);
          } else {
            (*held)->reply = reply;
          }
          (*held)->done = true;
          delete held;
        },
        new std::shared_ptr<Answer>(answer));
    spinUntil([&answer] { return answer->done; });
    return answer->reply;
  }
  // A property of the item, as a string or a boolean.
  std::string text(const Registered &at, const char *property) const {
    GVariant *reply = call(at, at.path.c_str(), "org.freedesktop.DBus.Properties", "Get", g_variant_new("(ss)", "org.kde.StatusNotifierItem", property));
    if (!reply) {
      return "<none>";
    }
    GVariant *value = nullptr;
    g_variant_get(reply, "(v)", &value);
    std::string out = g_variant_is_of_type(value, G_VARIANT_TYPE_BOOLEAN) ? (g_variant_get_boolean(value) ? "true" : "false")
        : g_variant_is_of_type(value, G_VARIANT_TYPE_STRING) || g_variant_is_of_type(value, G_VARIANT_TYPE_OBJECT_PATH)
        ? g_variant_get_string(value, nullptr)
        : "<other>";
    g_variant_unref(value);
    g_variant_unref(reply);
    return out;
  }
  // The registration whose item has the Id `id`.
  const Registered *item(const std::string &id) const {
    for (const auto &one : registered) {
      if (text(one, "Id") == id) {
        return &one;
      }
    }
    return nullptr;
  }
  bool hasOwner(const std::string &sender) const {
    GVariant *reply = g_dbus_connection_call_sync(
        bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner", g_variant_new("(s)", sender.c_str()),
        G_VARIANT_TYPE("(b)"), G_DBUS_CALL_FLAGS_NONE, 2000, nullptr, nullptr);
    gboolean owned = FALSE;
    g_variant_get(reply, "(b)", &owned);
    g_variant_unref(reply);
    return owned;
  }
};

// The labels of a menu's top level, as GetLayout gives them ("-" for a separator).
std::vector<std::string> menuLabels(const Watcher &watcher, const Watcher::Registered &at, guint32 *revision = nullptr) {
  GVariant *reply = watcher.call(at, "/MenuBar", "com.canonical.dbusmenu", "GetLayout", g_variant_new("(ii@as)", 0, -1, g_variant_new_strv(nullptr, 0)));
  std::vector<std::string> labels;
  if (!reply) {
    return labels;
  }
  guint32 rev = 0;
  GVariant *layout = nullptr;
  g_variant_get(reply, "(u@(ia{sv}av))", &rev, &layout);
  if (revision) {
    *revision = rev;
  }
  GVariant *children = g_variant_get_child_value(layout, 2);
  for (gsize i = 0; i < g_variant_n_children(children); ++i) {
    GVariant *boxed = g_variant_get_child_value(children, i);
    GVariant *child = g_variant_get_variant(boxed);
    GVariant *props = g_variant_get_child_value(child, 1);
    const gchar *label = nullptr, *type = nullptr;
    gboolean enabled = TRUE;
    g_variant_lookup(props, "label", "&s", &label);
    g_variant_lookup(props, "type", "&s", &type);
    g_variant_lookup(props, "enabled", "b", &enabled);
    labels.push_back(type ? "-" : std::string(label ? label : "?") + (enabled ? "" : " (disabled)"));
    g_variant_unref(props);
    g_variant_unref(child);
    g_variant_unref(boxed);
  }
  g_variant_unref(children);
  g_variant_unref(layout);
  g_variant_unref(reply);
  return labels;
}

// The ids GetGroupProperties answers for `ids`.
std::vector<gint32> groupPropertyIds(const Watcher &watcher, const Watcher::Registered &at, const std::vector<gint32> &ids) {
  GVariant *reply = watcher.call(at, "/MenuBar", "com.canonical.dbusmenu", "GetGroupProperties",
                                 g_variant_new("(@ai@as)", g_variant_new_fixed_array(G_VARIANT_TYPE_INT32, ids.data(), ids.size(), sizeof(gint32)), g_variant_new_strv(nullptr, 0)));
  std::vector<gint32> out;
  if (!reply) {
    return out;
  }
  GVariant *items = g_variant_get_child_value(reply, 0);
  for (gsize i = 0; i < g_variant_n_children(items); ++i) {
    GVariant *item = g_variant_get_child_value(items, i);
    GVariant *id = g_variant_get_child_value(item, 0);
    out.push_back(g_variant_get_int32(id));
    g_variant_unref(id);
    g_variant_unref(item);
  }
  g_variant_unref(items);
  g_variant_unref(reply);
  return out;
}

struct Heard {
  std::vector<std::string> events;
  ngn::gtk::TrayEvents sink() {
    return {
        .press = [this](const std::string &icon) { events.push_back("press " + icon); },
        .menuSelect = [this](const std::string &icon, const std::string &id) { events.push_back("select " + icon + " " + id); },
        .command = [this](ngn::MenuCommand command) { events.push_back(command == ngn::MenuCommand::Quit ? "quit" : "command"); },
    };
  }
};

std::vector<TrayIcon> twoIcons() {
  return {
      {.id = "t0", .title = "25:00", .tooltip = "Focus timer",
       .menu = std::vector<MenuItem>{{.title = "Pause", .command = ngn::MenuCommand::AppItem, .id = "0"}, {.separator = true},
                                     {.title = "Stop", .command = ngn::MenuCommand::AppItem, .id = "1", .disabled = true},
                                     {.title = "Quit", .command = ngn::MenuCommand::Quit, .id = "2"}}},
      {.id = "t1", .image = "emblem-synchronizing"},
  };
}

} // namespace

TEST_CASE("the tray is absent without a StatusNotifierWatcher and there with one") {
  if (!haveSessionBus()) {
    return;
  }
  CHECK_FALSE(ngn::gtk::statusNotifierWatcherRunning());
  {
    Watcher watcher;
    REQUIRE(watcher.owned);
    CHECK(ngn::gtk::statusNotifierWatcherRunning());
  }
  CHECK_FALSE(ngn::gtk::statusNotifierWatcherRunning());
}

TEST_CASE("each tray icon registers as a StatusNotifierItem with its title, icon, tooltip and menu") {
  if (!haveSessionBus()) {
    return;
  }
  Watcher watcher;
  Heard heard;
  auto tray = ngn::gtk::makeStatusNotifierTray("dev.ngnative.TrayTest", heard.sink());
  tray->setIcons(twoIcons());
  REQUIRE(spinUntil([&] { return watcher.registered.size() == 2; }));

  const auto *timer = watcher.item("dev.ngnative.TrayTest-t0");
  const auto *sync = watcher.item("dev.ngnative.TrayTest-t1");
  REQUIRE(timer);
  REQUIRE(sync);
  // Each icon on a connection of its own, registered by its item's path.
  CHECK(timer->sender != sync->sender);
  CHECK(timer->path == "/StatusNotifierItem");
  CHECK(watcher.text(*timer, "Title") == "25:00");
  CHECK(watcher.text(*timer, "Status") == "Active");
  CHECK(watcher.text(*timer, "IconName") == "dev.ngnative.TrayTest");
  CHECK(watcher.text(*timer, "ItemIsMenu") == "true");
  CHECK(watcher.text(*timer, "Menu") == "/MenuBar");
  CHECK(watcher.text(*sync, "IconName") == "emblem-synchronizing");
  CHECK(watcher.text(*sync, "ItemIsMenu") == "false");
  CHECK(watcher.text(*sync, "Title") == "dev.ngnative.TrayTest");

  CHECK(menuLabels(watcher, *timer) == std::vector<std::string>{"Pause", "-", "Stop (disabled)", "Quit"});
  // No ids asks for every item: the root and its four, as with the four named.
  CHECK(groupPropertyIds(watcher, *timer, {}) == std::vector<gint32>{0, 1, 2, 3, 4});
  CHECK(groupPropertyIds(watcher, *timer, {2, 4}) == std::vector<gint32>{2, 4});

  // A click on the icon with no menu presses it; Activate on one with a menu does nothing, as the
  // host opens the menu.
  drop(watcher.call(*sync, "/StatusNotifierItem", "org.kde.StatusNotifierItem", "Activate", g_variant_new("(ii)", 10, 10)));
  drop(watcher.call(*timer, "/StatusNotifierItem", "org.kde.StatusNotifierItem", "Activate", g_variant_new("(ii)", 10, 10)));
  // A menu item clicked, then the disabled one.
  drop(watcher.call(*timer, "/MenuBar", "com.canonical.dbusmenu", "Event", g_variant_new("(isvu)", 1, "clicked", g_variant_new_int32(0), 0)));
  drop(watcher.call(*timer, "/MenuBar", "com.canonical.dbusmenu", "Event", g_variant_new("(isvu)", 3, "clicked", g_variant_new_int32(0), 0)));
  // The OS's Quit, which the host runs rather than the app.
  drop(watcher.call(*timer, "/MenuBar", "com.canonical.dbusmenu", "Event", g_variant_new("(isvu)", 4, "clicked", g_variant_new_int32(0), 0)));
  spin();
  CHECK(heard.events == std::vector<std::string>{"press t1", "select t0 0", "quit"});
}

TEST_CASE("an icon sent again keeps its item and shows its change, and one left out goes") {
  if (!haveSessionBus()) {
    return;
  }
  Watcher watcher;
  Heard heard;
  auto tray = ngn::gtk::makeStatusNotifierTray("dev.ngnative.TrayTest", heard.sink());
  tray->setIcons(twoIcons());
  REQUIRE(spinUntil([&] { return watcher.registered.size() == 2; }));
  REQUIRE(watcher.item("dev.ngnative.TrayTest-t0"));
  REQUIRE(watcher.item("dev.ngnative.TrayTest-t1"));
  auto timer = *watcher.item("dev.ngnative.TrayTest-t0");
  auto sync = *watcher.item("dev.ngnative.TrayTest-t1");
  guint32 before = 0;
  menuLabels(watcher, timer, &before);

  int titles = 0, layouts = 0;
  auto count = [](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *signal, GVariant *, gpointer data) {
    auto *counts = static_cast<std::pair<int *, int *> *>(data);
    ++*(g_str_equal(signal, "LayoutUpdated") ? counts->second : counts->first);
  };
  std::pair<int *, int *> counts{&titles, &layouts};
  guint titleWatch = g_dbus_connection_signal_subscribe(watcher.bus, timer.sender.c_str(), "org.kde.StatusNotifierItem", "NewTitle", nullptr, nullptr, G_DBUS_SIGNAL_FLAGS_NONE, count, &counts, nullptr);
  guint layoutWatch = g_dbus_connection_signal_subscribe(watcher.bus, timer.sender.c_str(), "com.canonical.dbusmenu", "LayoutUpdated", nullptr, nullptr, G_DBUS_SIGNAL_FLAGS_NONE, count, &counts, nullptr);

  auto next = twoIcons();
  next.pop_back();
  next[0].title = "24:59";
  next[0].menu = std::vector<MenuItem>{{.title = "Resume", .command = ngn::MenuCommand::AppItem, .id = "2"}};
  tray->setIcons(next);
  REQUIRE(spinUntil([&] { return titles == 1 && layouts == 1 && !watcher.hasOwner(sync.sender); }));

  // The same item, not a new registration.
  CHECK(watcher.registered.size() == 2);
  CHECK(watcher.hasOwner(timer.sender));
  CHECK(watcher.text(timer, "Title") == "24:59");
  guint32 after = 0;
  CHECK(menuLabels(watcher, timer, &after) == std::vector<std::string>{"Resume"});
  CHECK(after > before);
  drop(watcher.call(timer, "/MenuBar", "com.canonical.dbusmenu", "Event", g_variant_new("(isvu)", 1, "clicked", g_variant_new_int32(0), 0)));
  spin();
  CHECK(heard.events == std::vector<std::string>{"select t0 2"});

  // The same icons again change nothing.
  tray->setIcons(next);
  spin();
  CHECK(titles == 1);
  g_dbus_connection_signal_unsubscribe(watcher.bus, titleWatch);
  g_dbus_connection_signal_unsubscribe(watcher.bus, layoutWatch);

  // None left: the last item goes too.
  tray->setIcons({});
  CHECK(spinUntil([&] { return !watcher.hasOwner(timer.sender); }));
}

TEST_CASE("an icon that gains or loses its menu tells the host to reread Menu and ItemIsMenu") {
  if (!haveSessionBus()) {
    return;
  }
  Watcher watcher;
  Heard heard;
  auto tray = ngn::gtk::makeStatusNotifierTray("dev.ngnative.TrayTest", heard.sink());
  tray->setIcons(twoIcons());
  REQUIRE(spinUntil([&] { return watcher.registered.size() == 2; }));
  auto sync = *watcher.item("dev.ngnative.TrayTest-t1");
  CHECK(watcher.text(sync, "ItemIsMenu") == "false");

  int changes = 0;
  auto count = [](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *params, gpointer data) {
    const gchar *interface = nullptr;
    GVariant *changed = nullptr;
    g_variant_get(params, "(&s@a{sv}as)", &interface, &changed, nullptr);
    if (g_str_equal(interface, "org.kde.StatusNotifierItem") && g_variant_lookup_value(changed, "Menu", nullptr) &&
        g_variant_lookup_value(changed, "ItemIsMenu", nullptr)) {
      ++*static_cast<int *>(data);
    }
    g_variant_unref(changed);
  };
  guint watch = g_dbus_connection_signal_subscribe(watcher.bus, sync.sender.c_str(), "org.freedesktop.DBus.Properties", "PropertiesChanged", nullptr,
                                                   nullptr, G_DBUS_SIGNAL_FLAGS_NONE, count, &changes, nullptr);
  auto gained = twoIcons();
  gained[1].menu = std::vector<MenuItem>{{.title = "Sync now", .command = ngn::MenuCommand::AppItem, .id = "0"}};
  tray->setIcons(gained);
  REQUIRE(spinUntil([&] { return changes == 1; }));
  CHECK(watcher.text(sync, "ItemIsMenu") == "true");
  CHECK(watcher.text(sync, "Menu") == "/MenuBar");

  // A change inside a menu it already has is the menu's own signal.
  gained[1].menu = std::vector<MenuItem>{{.title = "Sync later", .command = ngn::MenuCommand::AppItem, .id = "0"}};
  tray->setIcons(gained);
  spin();
  CHECK(changes == 1);

  tray->setIcons(twoIcons());
  REQUIRE(spinUntil([&] { return changes == 2; }));
  CHECK(watcher.text(sync, "ItemIsMenu") == "false");
  g_dbus_connection_signal_unsubscribe(watcher.bus, watch);
}

TEST_CASE("a watcher that starts again is given every icon again") {
  if (!haveSessionBus()) {
    return;
  }
  Heard heard;
  std::shared_ptr<ngn::TrayBackend> tray;
  {
    Watcher first;
    tray = ngn::gtk::makeStatusNotifierTray("dev.ngnative.TrayTest", heard.sink());
    tray->setIcons(twoIcons());
    REQUIRE(spinUntil([&] { return first.registered.size() == 2; }));
  }
  Watcher second;
  CHECK(spinUntil([&] { return second.registered.size() == 2; }));
  CHECK(second.item("dev.ngnative.TrayTest-t0"));
}

TEST_CASE("the badge count goes out as the launcher entry's count for the app's desktop entry") {
  if (!haveSessionBus()) {
    return;
  }
  CHECK(ngn::gtk::launcherEntryUri("dev.ngnative.Badge") == "application://dev.ngnative.Badge.desktop");
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  std::vector<std::string> heard;
  guint watch = g_dbus_connection_signal_subscribe(
      bus, nullptr, ngn::gtk::kLauncherEntryInterface, "Update", nullptr, nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
      [](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *args, gpointer data) {
        const gchar *uri = nullptr;
        GVariant *props = nullptr;
        g_variant_get(args, "(&s@a{sv})", &uri, &props);
        gint64 count = -1;
        gboolean visible = FALSE;
        g_variant_lookup(props, "count", "x", &count);
        g_variant_lookup(props, "count-visible", "b", &visible);
        static_cast<std::vector<std::string> *>(data)->push_back(std::string(uri) + " " + std::to_string(count) + (visible ? " shown" : " hidden"));
        g_variant_unref(props);
      },
      &heard, nullptr);

  auto center = ngn::gtk::makeLauncherBadgeNotifications("dev.ngnative.Badge");
  CHECK_FALSE(center->canPost());
  center->setBadge(3);
  CHECK(center->badge() == 3);
  center->setBadge(0);
  CHECK(spinUntil([&] { return heard.size() == 2; }));
  CHECK(heard == std::vector<std::string>{"application://dev.ngnative.Badge.desktop 3 shown", "application://dev.ngnative.Badge.desktop 0 hidden"});
  CHECK(center->badge() == 0);
  g_dbus_connection_signal_unsubscribe(bus, watch);
  g_object_unref(bus);
}
