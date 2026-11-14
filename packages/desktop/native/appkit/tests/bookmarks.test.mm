// The security-scoped bookmarks (bookmarks.mm) on real files in a temporary folder.
#include "../bookmarks.h"

#import <Foundation/Foundation.h>

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <random>

namespace fs = std::filesystem;

namespace {

struct TempDir {
  fs::path path;
  TempDir() {
    std::random_device random;
    auto at = fs::temp_directory_path() / ("ngn-bookmarks-" + std::to_string(random()));
    fs::create_directories(at);
    path = fs::canonical(at);
  }
  ~TempDir() {
    std::error_code ignored;
    fs::remove_all(path, ignored);
  }
};

} // namespace

TEST_CASE("a bookmark finds a picked file again after it moves, and none once it is gone") {
  TempDir dir;
  auto file = dir.path / "note.md";
  std::ofstream(file) << "kept";
  auto bookmarks = ngn::appkit::makeBookmarks();
  auto bookmark = bookmarks->make(file.string());
  REQUIRE(bookmark.has_value());
  auto here = bookmarks->resolve(*bookmark);
  REQUIRE(here.has_value());
  CHECK(here->path == file.string());

  auto moved = dir.path / "renamed.md";
  fs::rename(file, moved);
  auto there = bookmarks->resolve(*bookmark);
  REQUIRE(there.has_value());
  CHECK(there->path == moved.string());

  fs::remove(moved);
  CHECK_FALSE(bookmarks->resolve(*bookmark).has_value());
  CHECK_FALSE(bookmarks->resolve("not a bookmark").has_value());
}

TEST_CASE("access to a bookmark starts and stops in pairs, nested") {
  TempDir dir;
  auto bookmarks = ngn::appkit::makeBookmarks();
  auto bookmark = bookmarks->make(dir.path.string());
  REQUIRE(bookmark.has_value());
  // Outside the sandbox AppKit may decline: then there is nothing to stop.
  bool first = bookmarks->startAccess(*bookmark);
  bool second = bookmarks->startAccess(*bookmark);
  CHECK(first == second);
  if (first) {
    bookmarks->stopAccess(*bookmark);
  }
  if (second) {
    bookmarks->stopAccess(*bookmark);
  }
  // A stop with nothing started does nothing.
  bookmarks->stopAccess(*bookmark);
  CHECK_FALSE(bookmarks->startAccess("not a bookmark"));
}

TEST_CASE("the pick store keeps its picks in the user defaults, across stores") {
  TempDir dir;
  std::string key = "NGNTestPicks-" + std::to_string(std::random_device{}());
  NSString *name = [NSString stringWithUTF8String:key.c_str()];
  try {
    auto bookmarks = ngn::appkit::makeBookmarks();
    {
      ngn::PickStore store(ngn::appkit::pickPersistence(key), bookmarks);
      store.remember(dir.path.string());
    }
    CHECK(([NSUserDefaults.standardUserDefaults stringForKey:name] != nil));
    ngn::PickStore later(ngn::appkit::pickPersistence(key), bookmarks);
    CHECK(later.restore() == std::vector<std::string>{dir.path.string()});
  } catch (...) {
    [NSUserDefaults.standardUserDefaults removeObjectForKey:name];
    throw;
  }
  [NSUserDefaults.standardUserDefaults removeObjectForKey:name];
}
