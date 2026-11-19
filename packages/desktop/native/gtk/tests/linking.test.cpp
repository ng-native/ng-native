// Linking on GTK: which uris it can open, and opening one with no app for it.
#include "../host-sources.h"
#include "mounted-views.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <cstring>
#include <memory>
#include <optional>

TEST_CASE("Linking can open a uri whose scheme has an app, and any scheme inside a sandbox") {
  auto handles = [](const std::string &scheme) { return scheme == "https"; };
  CHECK(ngn::gtk::canOpenUri("https://example.com", false, handles));
  CHECK_FALSE(ngn::gtk::canOpenUri("ngn-nothing:x", false, handles));
  // The portal decides as it opens it.
  CHECK(ngn::gtk::canOpenUri("ngn-nothing:x", true, handles));
  // Not a uri at all.
  CHECK_FALSE(ngn::gtk::canOpenUri("example.com", true, handles));
}

TEST_CASE("Linking answers false, without blocking, for a uri no app opens") {
  REQUIRE(ngn::testing::gtkReady());
  // Through the OpenURI portal (inside a Flatpak or a Snap, or with GDK_DEBUG=portals) the answer
  // waits on the portal, which can ask the user to choose an app: this is the direct path only.
  const char *debug = g_getenv("GDK_DEBUG");
  if (g_file_test("/.flatpak-info", G_FILE_TEST_EXISTS) || g_getenv("SNAP") || (debug && strstr(debug, "portals"))) {
    MESSAGE("skipped: GTK opens uris through the desktop portal here");
    return;
  }
  adw_init();
  auto system = ngn::gtk::makeSystem("ngn.linking.test", g_get_tmp_dir());
  // Shared with the launch, which still answers into it after a wait that timed out.
  auto opened = std::make_shared<std::optional<bool>>();
  system->openUrl("ngn-no-such-scheme:x", [opened](bool ok) { *opened = ok; });
  // Asked on the main context: nothing has answered before it runs.
  CHECK_FALSE(opened->has_value());
  ngn::testing::runUntil([opened] { return opened->has_value(); });
  CHECK_FALSE(**opened);
}
