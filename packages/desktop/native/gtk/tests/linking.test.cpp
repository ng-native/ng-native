// Linking on GTK: which uris it can open, and opening one with no app for it.
#include "../host-sources.h"
#include "mounted-views.h"

#include <adwaita.h>
#include <doctest/doctest.h>

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
  adw_init();
  auto system = ngn::gtk::makeSystem("ngn.linking.test", g_get_tmp_dir());
  std::optional<bool> opened;
  system->openUrl("ngn-no-such-scheme:x", [&opened](bool ok) { opened = ok; });
  // Asked on the main context: nothing has answered before it runs.
  CHECK_FALSE(opened.has_value());
  ngn::testing::runUntil([&opened] { return opened.has_value(); });
  CHECK_FALSE(*opened);
}
