// The desktop's accessibility settings on GTK (accessibility-settings.h): read at start and followed
// as GTK's own settings change, each source that is not there counting as off.
#include "mounted-views.h"

#include "../accessibility-settings.h"
#include "fake-settings-portal.h"

#include <doctest/doctest.h>

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
