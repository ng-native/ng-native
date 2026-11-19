// The desktop's accent colour below libadwaita 1.6 (accent-colour.h): read from the settings portal
// at start, applied over libadwaita's stylesheet, and followed as it changes and goes. From 1.6
// libadwaita follows it itself and the host applies nothing.
#include "mounted-views.h"

#include "../accent-colour.h"
#include "fake-settings-portal.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <cstdlib>

TEST_CASE("the portal's accent colour is libadwaita's accent below 1.6, followed as it changes and goes") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::FakeSettingsPortal portal({{{"org.freedesktop.appearance", "accent-color"}, g_variant_new("(ddd)", 0.6, 0.2, 0.8)}});
  if (!portal.owned()) {
    REQUIRE_MESSAGE(getenv("CI") == nullptr, "the portal tests need a session bus: run them under dbus-run-session");
    MESSAGE("skipped: no session bus");
    return;
  }
  ngn::gtk::AccentFollower accent;
  if (adw_get_minor_version() >= 6) {
    // libadwaita's own.
    portal.spinUntil([] { return false; });
    CHECK(accent.css().empty());
    return;
  }
  bool dark = adw_style_manager_get_dark(adw_style_manager_get_default());
  auto purple = ngn::accentCss(*ngn::accentColors({0.6, 0.2, 0.8}, dark));
  CHECK(portal.spinUntil([&] { return accent.css() == purple; }));

  portal.set("org.freedesktop.appearance", "accent-color", g_variant_new("(ddd)", 0.1, 0.8, 0.2));
  auto green = ngn::accentCss(*ngn::accentColors({0.1, 0.8, 0.2}, dark));
  CHECK(portal.spinUntil([&] { return accent.css() == green; }));

  // Out of range: the desktop sets none, and libadwaita's own blue comes back.
  portal.set("org.freedesktop.appearance", "accent-color", g_variant_new("(ddd)", -1.0, -1.0, -1.0));
  CHECK(portal.spinUntil([&] { return accent.css().empty(); }));
}
