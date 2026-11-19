// The desktop's accessibility settings on GTK (accessibility-settings.h): read at start and followed
// as GTK's own settings change, each source that is not there counting as off.
#include "mounted-views.h"

#include "../accessibility-settings.h"

#include <doctest/doctest.h>

#include <vector>

TEST_CASE("GNOME's Animations switch off is reduce motion, heard as it changes") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  gboolean was = TRUE;
  g_object_get(settings, "gtk-enable-animations", &was, nullptr);
  g_object_set(settings, "gtk-enable-animations", TRUE, nullptr);
  std::vector<ngn::AccessibilitySettings> heard;
  try {
    ngn::gtk::AccessibilitySettingsWatcher watcher([&heard](const ngn::AccessibilitySettings &s) { heard.push_back(s); });
    // At start, with nothing asking for less motion here.
    REQUIRE(heard.size() == 1);
    CHECK_FALSE(heard.back().reduceMotion);
    g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);
    REQUIRE(heard.size() == 2);
    CHECK(heard.back().reduceMotion);
    CHECK_FALSE(watcher.sources().animations);
    // The same again is no change to report.
    g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);
    CHECK(heard.size() == 2);
    g_object_set(settings, "gtk-enable-animations", TRUE, nullptr);
    CHECK_FALSE(heard.back().reduceMotion);
  } catch (...) {
    g_object_set(settings, "gtk-enable-animations", was, nullptr);
    throw;
  }
  // Gone, it hears no more.
  size_t count = heard.size();
  g_object_set(settings, "gtk-enable-animations", FALSE, nullptr);
  CHECK(heard.size() == count);
  g_object_set(settings, "gtk-enable-animations", was, nullptr);
}
