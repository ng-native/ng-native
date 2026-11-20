// The desktop's accessibility settings on GTK (accessibility-settings.h): read at start and followed
// as GTK's own settings change, each source that is not there counting as off.
#include "mounted-views.h"

#include "../accessibility-settings.h"
#include "fake-settings-portal.h"

#include <doctest/doctest.h>

#include <cstring>
#include <memory>
#include <optional>
#include <string>
#include <vector>

TEST_CASE("the settings portal's contrast is increase contrast, read at start and followed as it changes") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::FakeSettingsPortal portal({
      {{"org.freedesktop.appearance", "contrast"}, g_variant_new_uint32(1)},
      {{"org.freedesktop.appearance", "reduced-motion"}, g_variant_new_uint32(0)},
  });
  if (!portal.owned()) {
    REQUIRE_MESSAGE(getenv("CI") == nullptr, "the portal tests need a session bus: run them under dbus-run-session");
    MESSAGE("skipped: no session bus");
    return;
  }
  std::vector<ngn::AccessibilitySettings> heard;
  ngn::gtk::AccessibilitySettingsWatcher watcher([&heard](const ngn::AccessibilitySettings &s) { heard.push_back(s); });
  CHECK(portal.spinUntil([&watcher] { return watcher.sources().portalContrast; }));
  CHECK(heard.back().increaseContrast);
  CHECK_FALSE(watcher.sources().portalReducedMotion);

  portal.set("org.freedesktop.appearance", "contrast", g_variant_new_uint32(0));
  CHECK(portal.spinUntil([&watcher] { return !watcher.sources().portalContrast; }));
  CHECK(heard.back().increaseContrast == watcher.sources().highContrast);
  // The other key, through the same signal.
  portal.set("org.freedesktop.appearance", "reduced-motion", g_variant_new_uint32(1));
  CHECK(portal.spinUntil([&watcher] { return watcher.sources().portalReducedMotion; }));
  CHECK(heard.back().reduceMotion);
}

TEST_CASE("the portal stand-in shuts down when asked before its worker reaches the loop") {
  // The worker waits 300 ms before its loop and the constructor 50 ms for the name, so the
  // destructor's quit comes first. A quit that is lost leaves the join waiting for ever.
  ngn::testing::FakeSettingsPortal portal({}, 300, 50);
  CHECK_FALSE(portal.owned());
}

TEST_CASE("GNOME's Animations switch off is reduce motion, heard as it changes") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  gboolean was = TRUE;
  g_object_get(settings, "gtk-enable-animations", &was, nullptr);
  g_object_set(settings, "gtk-enable-animations", TRUE, nullptr);
  std::vector<ngn::AccessibilitySettings> heard;
  try {
    ngn::gtk::AccessibilitySettingsWatcher watcher([&heard](const ngn::AccessibilitySettings &s) { heard.push_back(s); });
    // Heard at start. The portal and AT-SPI answer later, if at all, and say what this session says.
    REQUIRE_FALSE(heard.empty());
    auto otherwise = [&watcher] { return watcher.sources().portalReducedMotion || watcher.sources().gtkReducedMotion; };
    g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);
    CHECK_FALSE(watcher.sources().animations);
    CHECK(heard.back().reduceMotion);
    // The same again is no change to report.
    size_t count = heard.size();
    g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);
    CHECK(heard.size() == count);
    g_object_set(settings, "gtk-enable-animations", TRUE, nullptr);
    CHECK(watcher.sources().animations);
    CHECK(heard.back().reduceMotion == otherwise());
  } catch (...) {
    g_object_set(settings, "gtk-enable-animations", was, nullptr);
    throw;
  }
  // Gone, it hears no more.
  size_t count = heard.size();
  g_object_set(settings, "gtk-enable-animations", !was, nullptr);
  CHECK(heard.size() == count);
  g_object_set(settings, "gtk-enable-animations", was, nullptr);
}

TEST_CASE("the host's state is made with its accessibility settings, read at start and followed") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  gboolean was = TRUE;
  g_object_get(settings, "gtk-enable-animations", &was, nullptr);
  g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);
  try {
    auto made = ngn::gtk::makeWatchedHostState();
    REQUIRE(made.state);
    REQUIRE(made.accessibility);
    CHECK(made.state->accessibility.get().reduceMotion);
    g_object_set(settings, "gtk-enable-animations", TRUE, nullptr);
    auto &sources = made.accessibility->sources();
    CHECK(made.state->accessibility.get().reduceMotion == (sources.portalReducedMotion || sources.gtkReducedMotion));
  } catch (...) {
    g_object_set(settings, "gtk-enable-animations", was, nullptr);
    throw;
  }
  g_object_set(settings, "gtk-enable-animations", was, nullptr);
}

TEST_CASE("only GTK's more-contrast value asks for more contrast") {
  // GtkInterfaceContrast: unsupported, no preference, more, less.
  CHECK_FALSE(ngn::gtk::gtkWantsMoreContrast(0));
  CHECK_FALSE(ngn::gtk::gtkWantsMoreContrast(1));
  CHECK(ngn::gtk::gtkWantsMoreContrast(2));
  CHECK_FALSE(ngn::gtk::gtkWantsMoreContrast(3));
}

namespace {

// A settings portal on a private bus: it answers ReadOne and Read as `oneWorks` and `readWorks` say,
// with `value`, and counts the calls of the connection named in `counted`: libadwaita asks the portal
// too, on whatever session bus address the process has as it connects, and its calls are not the
// watcher's.
struct FakePortal {
  GDBusConnection *connection{nullptr};
  guint registration{0};
  guint name{0};
  int readOne{0};
  int read{0};
  bool oneWorks{true};
  bool readWorks{true};
  guint32 value{0};
  std::string counted;

  explicit FakePortal(const char *address) {
    GError *error = nullptr;
    connection = g_dbus_connection_new_for_address_sync(
        address, GDBusConnectionFlags(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION), nullptr,
        nullptr, &error);
    REQUIRE(connection);
    static const char *xml =
        "<node><interface name='org.freedesktop.portal.Settings'>"
        "<method name='ReadOne'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='v' direction='out'/></method>"
        "<method name='Read'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='v' direction='out'/></method>"
        "</interface></node>";
    GDBusNodeInfo *info = g_dbus_node_info_new_for_xml(xml, nullptr);
    static const GDBusInterfaceVTable vtable = {
        +[](GDBusConnection *, const char *sender, const char *, const char *, const char *method, GVariant *, GDBusMethodInvocation *invocation,
            gpointer data) {
          auto *self = static_cast<FakePortal *>(data);
          bool one = std::strcmp(method, "ReadOne") == 0;
          if (self->counted.empty() || self->counted == sender) {
            (one ? self->readOne : self->read)++;
          }
          if (!(one ? self->oneWorks : self->readWorks)) {
            g_dbus_method_invocation_return_dbus_error(invocation, "org.freedesktop.DBus.Error.UnknownMethod", "no such method");
            return;
          }
          GVariant *number = g_variant_new_uint32(self->value);
          // ReadOne gives the value; the older Read wraps it in another variant.
          g_dbus_method_invocation_return_value(invocation, g_variant_new("(v)", one ? number : g_variant_new_variant(number)));
        },
        nullptr, nullptr, {}};
    registration = g_dbus_connection_register_object(connection, "/org/freedesktop/portal/desktop", info->interfaces[0], &vtable, this, nullptr, nullptr);
    g_dbus_node_info_unref(info);
  }
  void own() {
    name = g_bus_own_name_on_connection(connection, "org.freedesktop.portal.Desktop", G_BUS_NAME_OWNER_FLAGS_NONE, nullptr, nullptr, nullptr, nullptr);
  }
  void disown() {
    g_bus_unown_name(name);
    name = 0;
  }
  ~FakePortal() {
    if (name) {
      g_bus_unown_name(name);
    }
    g_dbus_connection_close(connection, nullptr, nullptr, nullptr);
    g_object_unref(connection);
  }
};

void idleFor(int milliseconds) {
  gint64 until = g_get_monotonic_time() + milliseconds * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
}

// A private session bus, with a portal of its own and not the desktop's, and a connection to it for the
// watcher, which then never touches the shared session connection. No connection where there is no way
// to make one (no dbus-daemon, or one that will not take this user).
struct PrivateBus {
  GTestDBus *bus{nullptr};
  GDBusConnection *client{nullptr};
  std::string address;
  // g_test_dbus_up points DBUS_SESSION_BUS_ADDRESS at the private bus and g_test_dbus_down unsets it,
  // so the session bus the run was started under (dbus-run-session) is put back for the tests after.
  std::optional<std::string> sessionAddress;
  PrivateBus() {
    if (!g_find_program_in_path("dbus-daemon")) {
      return;
    }
    if (const char *was = g_getenv("DBUS_SESSION_BUS_ADDRESS")) {
      sessionAddress = was;
    }
    bus = g_test_dbus_new(G_TEST_DBUS_NONE);
    g_test_dbus_up(bus);
    address = g_test_dbus_get_bus_address(bus);
    GError *error = nullptr;
    client = g_dbus_connection_new_for_address_sync(
        address.c_str(),
        GDBusConnectionFlags(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION), nullptr, nullptr,
        &error);
    if (!client) {
      MESSAGE("no connection to the bus: " << std::string(error->message));
      g_error_free(error);
    }
  }
  explicit operator bool() const {
    return client != nullptr;
  }
  ~PrivateBus() {
    if (client) {
      g_dbus_connection_close(client, nullptr, nullptr, nullptr);
      g_object_unref(client);
    }
    if (bus) {
      g_test_dbus_down(bus);
      g_object_unref(bus);
      if (sessionAddress) {
        g_setenv("DBUS_SESSION_BUS_ADDRESS", sessionAddress->c_str(), TRUE);
      } else {
        g_unsetenv("DBUS_SESSION_BUS_ADDRESS");
      }
    }
  }
};

} // namespace

TEST_CASE("a private bus puts the run's session bus address back when it goes") {
  const char *was = g_getenv("DBUS_SESSION_BUS_ADDRESS");
  std::optional<std::string> before;
  if (was) {
    before = was;
  }
  {
    PrivateBus bus;
    if (!bus) {
      MESSAGE("no private bus to run");
      return;
    }
    CHECK(g_getenv("DBUS_SESSION_BUS_ADDRESS") != nullptr);
  }
  const char *after = g_getenv("DBUS_SESSION_BUS_ADDRESS");
  CHECK((after != nullptr) == before.has_value());
  if (after && before) {
    CHECK(std::string(after) == *before);
  }
}

TEST_CASE("the portal's reduced motion is read again when its owner changes, and let go of when it goes") {
  REQUIRE(ngn::testing::gtkReady());
  // libadwaita asks the portal for its settings, once and synchronously, as it starts: before there is
  // a portal on the bus that would answer only after the call timed out.
  adw_style_manager_get_default();
  PrivateBus bus;
  if (!bus) {
    MESSAGE("no private bus to run");
    return;
  }
  const char *address = bus.address.c_str();
  auto portal = std::make_unique<FakePortal>(address);
  portal->value = 1;
  portal->own();
  ngn::gtk::AccessibilitySettingsWatcher watcher([](const ngn::AccessibilitySettings &) {}, bus.client);
  ngn::testing::runUntil([&] { return watcher.sources().portalReducedMotion; });

  // The portal goes: its value goes with it.
  portal->disown();
  ngn::testing::runUntil([&] { return !watcher.sources().portalReducedMotion; });

  // Another owner, whose first value is not announced as a change, is read as it appears.
  portal->value = 1;
  portal->own();
  ngn::testing::runUntil([&] { return watcher.sources().portalReducedMotion; });
}

TEST_CASE("the portal is asked with Read only where it has no ReadOne, and no more once Read fails too") {
  REQUIRE(ngn::testing::gtkReady());
  // libadwaita asks the portal for its settings, once and synchronously, as it starts: before there is
  // a portal on the bus that would answer only after the call timed out.
  adw_style_manager_get_default();
  PrivateBus bus;
  if (!bus) {
    MESSAGE("no private bus to run");
    return;
  }
  const char *address = bus.address.c_str();
  // The watcher reads two settings, reduced motion and contrast, each with ReadOne and then Read.
  constexpr int kKeys = 2;
  FakePortal portal(address);
  portal.oneWorks = false;
  portal.value = 1;
  portal.counted = g_dbus_connection_get_unique_name(bus.client);
  portal.own();
  {
    // The older portal: Read answers.
    ngn::gtk::AccessibilitySettingsWatcher watcher([](const ngn::AccessibilitySettings &) {}, bus.client);
    ngn::testing::runUntil([&] { return watcher.sources().portalReducedMotion && portal.read == kKeys; });
    CHECK(portal.readOne == kKeys);
    CHECK(portal.read == kKeys);
  }
  // A portal that has neither: one of each per setting, and then nothing.
  portal.readWorks = false;
  portal.readOne = portal.read = 0;
  ngn::gtk::AccessibilitySettingsWatcher watcher([](const ngn::AccessibilitySettings &) {}, bus.client);
  // Both settings fall back, then nothing more is asked.
  ngn::testing::runUntil([&] { return portal.read == kKeys; });
  idleFor(300);
  CHECK(portal.readOne == kKeys);
  CHECK(portal.read == kKeys);
  CHECK_FALSE(watcher.sources().portalReducedMotion);
}
