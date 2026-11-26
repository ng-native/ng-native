#include "ngn/host-reload.h"

#include <doctest/doctest.h>

TEST_CASE("a host's reloads go where they are routed, and nowhere once the route is taken away") {
  int host = 0, other = 0;
  int reloads = 0;
  CHECK_FALSE(ngn::reloadThroughRoute(&host));
  ngn::routeHostReload(&host, [&reloads] { ++reloads; });
  CHECK(ngn::reloadThroughRoute(&host));
  CHECK(reloads == 1);
  CHECK_FALSE(ngn::reloadThroughRoute(&other));
  // A reload that routes the host again, as a reload's new host does, takes no lock it holds.
  ngn::routeHostReload(&host, [&] {
    ++reloads;
    ngn::routeHostReload(&host, nullptr);
  });
  CHECK(ngn::reloadThroughRoute(&host));
  CHECK(reloads == 2);
  CHECK_FALSE(ngn::reloadThroughRoute(&host));
}
