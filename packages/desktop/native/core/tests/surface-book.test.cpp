#include "ngn/surface-book.h"

#include <doctest/doctest.h>

#include <string>

TEST_CASE("SurfaceBook applies changes at once, and only writes them down during a reload") {
  ngn::SurfaceBook<std::string> book;
  CHECK(book.start(1, "main"));
  CHECK(book.update(1, [](std::string &s) { s += " resized"; }));
  CHECK_FALSE(book.update(9, [](std::string &) {}));

  REQUIRE(book.beginReload());
  CHECK_FALSE(book.beginReload());
  // The UI thread carries on: a window opens, another closes, one resizes, none of it waits.
  CHECK_FALSE(book.start(2, "notes"));
  CHECK_FALSE(book.start(3, "short-lived"));
  CHECK_FALSE(book.stop(3));
  CHECK_FALSE(book.update(1, [](std::string &s) { s = "main at 800x600"; }));

  // The reload restarts what the book has, with what it was given since.
  std::set<facebook::react::SurfaceId> started;
  auto step = book.settle(started);
  REQUIRE(step);
  CHECK(step->start == std::vector<std::pair<facebook::react::SurfaceId, std::string>>{{1, "main at 800x600"}, {2, "notes"}});
  CHECK(step->stop.empty());
  started = {1, 2};

  // A window that closed while the reload started it is stopped before the reload ends.
  CHECK_FALSE(book.stop(2));
  step = book.settle(started);
  REQUIRE(step);
  CHECK(step->start.empty());
  CHECK(step->stop == std::vector<facebook::react::SurfaceId>{2});
  started = {1};

  CHECK_FALSE(book.settle(started));
  CHECK_FALSE(book.reloading());
  CHECK(book.start(4, "after"));
  CHECK(book.stop(4));
  CHECK_FALSE(book.stop(4));
}

TEST_CASE("SurfaceBook brings a surface the reload restarted up to a change made after it restarted") {
  ngn::SurfaceBook<std::string> book;
  book.start(1, "main at 400x300");
  REQUIRE(book.beginReload());
  std::set<facebook::react::SurfaceId> started;
  auto step = book.settle(started);
  REQUIRE(step);
  CHECK(step->start == std::vector<std::pair<facebook::react::SurfaceId, std::string>>{{1, "main at 400x300"}});
  started = {1};

  // The window resizes once its surface has restarted, and before the reload has ended.
  CHECK_FALSE(book.update(1, [](std::string &s) { s = "main at 800x600"; }));
  step = book.settle(started);
  REQUIRE(step);
  CHECK(step->start.empty());
  CHECK(step->stop.empty());
  CHECK(step->update == std::vector<std::pair<facebook::react::SurfaceId, std::string>>{{1, "main at 800x600"}});

  CHECK_FALSE(book.settle(started));
  CHECK_FALSE(book.reloading());
}
