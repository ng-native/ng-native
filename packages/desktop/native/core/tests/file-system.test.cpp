#include "ngn/file-system.h"

#include <doctest/doctest.h>

#include <filesystem>
#include <fstream>
#include <map>
#include <random>
#include <set>

#include <folly/json.h>

#include "ngn/bytes.h"

using folly::dynamic;
namespace fs = std::filesystem;
using Access = ngn::FileAccess::Access;

namespace {

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(
      method, args,
      {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

// A folder of its own for each test, removed however the test ends. Canonical, since /var is a
// link to /private/var on macOS.
struct TempDir {
  fs::path path;
  TempDir() {
    std::random_device random;
    auto at = fs::temp_directory_path() / ("ngn-files-" + std::to_string(random()));
    fs::create_directories(at);
    path = fs::canonical(at);
  }
  ~TempDir() {
    std::error_code ignored;
    fs::remove_all(path, ignored);
  }
};

void write(const fs::path &file, const std::string &text) {
  fs::create_directories(file.parent_path());
  std::ofstream(file) << text;
}

ngn::FileAccess::Folders foldersIn(const fs::path &root) {
  for (const char *name : {"cache", "document", "data", "tmp", "home/Desktop", "home/Downloads", "outside"}) {
    fs::create_directories(root / name);
  }
  return {
      .cache = (root / "cache").string(),
      .document = (root / "document").string(),
      .appData = (root / "data").string(),
      .temp = (root / "tmp").string(),
      .home = (root / "home").string(),
      .desktop = (root / "home/Desktop").string(),
      .downloads = (root / "home/Downloads").string(),
  };
}

struct FakeWatcher final : ngn::FileWatcher {
  std::map<int, std::pair<std::string, std::function<void(std::vector<Event>)>>> watches;
  int next{0};
  int start(const std::string &path, std::function<void(std::vector<Event>)> events) override {
    watches[++next] = {path, std::move(events)};
    return next;
  }
  void stop(int handle) override {
    watches.erase(handle);
  }
};

} // namespace

TEST_CASE("fileUri percent-encodes a path, and pathOfUri reads one back or a plain absolute path") {
  CHECK(ngn::fileUri("/Users/a/My Notes #1.md") == "file:///Users/a/My%20Notes%20%231.md");
  CHECK(ngn::pathOfUri("file:///Users/a/My%20Notes%20%231.md") == "/Users/a/My Notes #1.md");
  CHECK(ngn::pathOfUri("/tmp/x") == "/tmp/x");
  CHECK_FALSE(ngn::pathOfUri("https://example.com/x"));
  CHECK_FALSE(ngn::pathOfUri("relative/x"));
  CHECK_FALSE(ngn::pathOfUri("file://host/x"));
}

TEST_CASE("FileAccess lets the app at its own folders, and at the user's only as declared") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  ngn::FileAccess none(folders, dynamic::array());
  CHECK(none.accessTo((dir.path / "cache/a.txt").string()) == Access::ReadWrite);
  CHECK(none.accessTo((dir.path / "data/sub/b").string()) == Access::ReadWrite);
  CHECK(none.accessTo((dir.path / "home/Desktop").string()) == Access::None);
  CHECK(none.accessTo((dir.path / "outside").string()) == Access::None);
  // A sibling whose name starts the same is not inside.
  CHECK(none.accessTo((dir.path / "cache-other").string()) == Access::None);

  ngn::FileAccess declared(
      folders,
      dynamic::array(dynamic::object("path", "~/Desktop")("access", "read"),
                     dynamic::object("path", (dir.path / "outside").string())("access", "readwrite"),
                     dynamic::object("path", "relative/ignored")("access", "readwrite")));
  CHECK(declared.accessTo((dir.path / "home/Desktop/n.txt").string()) == Access::Read);
  CHECK(declared.accessTo((dir.path / "home/Downloads").string()) == Access::None);
  CHECK(declared.accessTo((dir.path / "outside/x").string()) == Access::ReadWrite);
}

TEST_CASE("FileAccess follows a symbolic link before it decides, and reaches what the user picked") {
  TempDir dir;
  ngn::FileAccess access(foldersIn(dir.path), dynamic::array());
  fs::create_directory_symlink(dir.path / "outside", dir.path / "data/link");
  CHECK(access.accessTo((dir.path / "data/link/secret").string()) == Access::None);
  CHECK(access.accessTo((dir.path / "data/../outside").string()) == Access::None);

  access.allowPicked((dir.path / "outside").string());
  CHECK(access.accessTo((dir.path / "data/link/secret").string()) == Access::ReadWrite);
}

TEST_CASE("FileSystem lists the folders it can reach, as uris ending in a slash") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto module = ngn::makeFileSystemModule(
      std::make_shared<ngn::FileAccess>(folders, dynamic::array(dynamic::object("path", "~/Downloads")("access", "read"))),
      std::make_shared<FakeWatcher>());
  auto paths = module->property("paths");
  CHECK(paths["cache"] == dynamic(ngn::fileUri(folders.cache) + "/"));
  CHECK(paths["document"] == dynamic(ngn::fileUri(folders.document) + "/"));
  CHECK(paths["appData"] == dynamic(ngn::fileUri(folders.appData) + "/"));
  CHECK(paths["temp"] == dynamic(ngn::fileUri(folders.temp) + "/"));
  CHECK(paths["downloads"] == dynamic(ngn::fileUri(folders.downloads) + "/"));
  CHECK_FALSE(paths.count("home"));
  CHECK_FALSE(paths.count("desktop"));
  CHECK(module->property("documentDirectory") == paths["document"]);
  CHECK(module->property("cacheDirectory") == paths["cache"]);
}

TEST_CASE("FileSystem reads folders and describes what is at a path, within reach") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()),
                                          std::make_shared<FakeWatcher>());
  write(dir.path / "document/b.txt", "hello");
  fs::create_directory(dir.path / "document/a folder");
  auto docs = ngn::fileUri(folders.document);

  auto list = ask(*module, "readdir", dynamic::array(docs));
  REQUIRE(list.value);
  CHECK(*list.value == dynamic::array(
                           dynamic::object("name", "a folder")("uri", ngn::fileUri(folders.document + "/a folder"))("directory", true),
                           dynamic::object("name", "b.txt")("uri", ngn::fileUri(folders.document + "/b.txt"))("directory", false)));

  auto file = ask(*module, "stat", dynamic::array(docs + "/b.txt"));
  REQUIRE(file.value);
  CHECK((*file.value)["directory"] == dynamic(false));
  CHECK((*file.value)["size"] == dynamic(5));
  CHECK((*file.value)["uri"] == dynamic(docs + "/b.txt"));
  CHECK((*file.value)["modified"].isNumber());
  CHECK((*file.value)["modified"].asDouble() > 1.7e12);
  CHECK(ask(*module, "stat", dynamic::array(docs + "/missing")).value == dynamic(nullptr));

  auto outside = ngn::fileUri((dir.path / "outside").string());
  CHECK(ask(*module, "readdir", dynamic::array(outside)).error);
  CHECK(ask(*module, "stat", dynamic::array(outside)).error);
  CHECK(ask(*module, "readdir", dynamic::array(docs + "/b.txt")).error);
}

TEST_CASE("FileSystem reads and writes text and base64, and refuses to write where it may only read") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto module = ngn::makeFileSystemModule(
      std::make_shared<ngn::FileAccess>(
          folders, dynamic::array(dynamic::object("path", (dir.path / "outside").string())("access", "read"))),
      std::make_shared<FakeWatcher>());
  auto file = ngn::fileUri(folders.cache + "/n.txt");
  CHECK(ask(*module, "writeAsStringAsync", dynamic::array(file, "one")).value == dynamic(nullptr));
  ask(*module, "writeAsStringAsync", dynamic::array(file, " two", dynamic::object("append", true)));
  CHECK(ask(*module, "readAsStringAsync", dynamic::array(file)).value == dynamic("one two"));
  ask(*module, "writeAsStringAsync", dynamic::array(file, "AAEC/w==", dynamic::object("encoding", "base64")));
  CHECK(fs::file_size(dir.path / "cache/n.txt") == 4);
  CHECK(ask(*module, "readAsStringAsync", dynamic::array(file, dynamic::object("encoding", "base64"))).value ==
        dynamic("AAEC/w=="));

  write(dir.path / "outside/r.txt", "read me");
  auto readOnly = ngn::fileUri((dir.path / "outside/r.txt").string());
  CHECK(ask(*module, "readAsStringAsync", dynamic::array(readOnly)).value == dynamic("read me"));
  CHECK(ask(*module, "writeAsStringAsync", dynamic::array(readOnly, "x")).error);
  CHECK(ask(*module, "deleteAsync", dynamic::array(readOnly)).error);
  CHECK(fs::exists(dir.path / "outside/r.txt"));
}

TEST_CASE("FileSystem makes folders and files, moves, copies and deletes, within reach") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()),
                                          std::make_shared<FakeWatcher>());
  auto data = ngn::fileUri(folders.appData);
  CHECK(ask(*module, "makeDirectoryAsync", dynamic::array(data + "/a/b")).error);
  CHECK(ask(*module, "makeDirectoryAsync", dynamic::array(data + "/a/b", dynamic::object("intermediates", true))).value ==
        dynamic(nullptr));
  CHECK(fs::is_directory(dir.path / "data/a/b"));

  auto created = ask(*module, "createFile", dynamic::array(data + "/a", "new note.md"));
  REQUIRE(created.value);
  CHECK((*created.value)["uri"] == dynamic(ngn::fileUri(folders.appData + "/a/new note.md")));
  CHECK(fs::file_size(dir.path / "data/a/new note.md") == 0);
  CHECK(ask(*module, "createFile", dynamic::array(data + "/a", "new note.md")).error);
  CHECK(ask(*module, "createFile", dynamic::array(data + "/a", "../escape.md")).error);

  CHECK(ask(*module, "copyAsync", dynamic::array(dynamic::object("from", data + "/a/new%20note.md")("to", data + "/copy.md")))
            .value == dynamic(nullptr));
  CHECK(ask(*module, "moveAsync", dynamic::array(dynamic::object("from", data + "/copy.md")("to", data + "/moved.md"))).value ==
        dynamic(nullptr));
  CHECK_FALSE(fs::exists(dir.path / "data/copy.md"));
  CHECK(fs::exists(dir.path / "data/moved.md"));
  CHECK(ask(*module, "moveAsync",
            dynamic::array(dynamic::object("from", data + "/moved.md")("to", ngn::fileUri((dir.path / "outside/m.md").string()))))
            .error);

  CHECK(ask(*module, "deleteAsync", dynamic::array(data + "/a")).value == dynamic(nullptr));
  CHECK_FALSE(fs::exists(dir.path / "data/a"));
  CHECK(ask(*module, "deleteAsync", dynamic::array(data + "/a")).error);
  CHECK(ask(*module, "deleteAsync", dynamic::array(data + "/a", dynamic::object("idempotent", true))).value == dynamic(nullptr));
}

TEST_CASE("FileSystem answers each call synchronously too, as <name>Sync, throwing its failure") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto module = ngn::makeFileSystemModule(
      std::make_shared<ngn::FileAccess>(
          folders, dynamic::array(dynamic::object("path", (dir.path / "outside").string())("access", "read"))),
      std::make_shared<FakeWatcher>());
  auto data = ngn::fileUri(folders.appData);
  auto file = data + "/a/n.txt";

  CHECK(module->call("statSync", dynamic::array(file)) == dynamic(nullptr));
  CHECK_THROWS_WITH_AS(module->call("writeAsStringSync", dynamic::array(file, "x")), doctest::Contains("could not be written"),
                       std::exception);
  CHECK(module->call("makeDirectorySync", dynamic::array(data + "/a", dynamic::object("intermediates", true))) == dynamic(nullptr));
  CHECK(module->call("writeAsStringSync", dynamic::array(file, "one")) == dynamic(nullptr));
  module->call("writeAsStringSync", dynamic::array(file, " two", dynamic::object("append", true)));
  // Written by the time the call returns.
  CHECK(module->call("readAsStringSync", dynamic::array(file)) == dynamic("one two"));
  auto info = module->call("statSync", dynamic::array(file));
  CHECK(info["size"] == dynamic(7));
  CHECK(info["directory"] == dynamic(false));
  module->call("writeAsStringSync", dynamic::array(file, "AAEC/w==", dynamic::object("encoding", "base64")));
  CHECK(module->call("readAsStringSync", dynamic::array(file, dynamic::object("encoding", "base64"))) == dynamic("AAEC/w=="));

  CHECK(module->call("readdirSync", dynamic::array(data + "/a")) ==
        dynamic::array(dynamic::object("name", "n.txt")("uri", ngn::fileUri(folders.appData + "/a/n.txt"))("directory", false)));
  CHECK(module->call("createFileSync", dynamic::array(data + "/a", "m.txt")) ==
        dynamic::object("uri", ngn::fileUri(folders.appData + "/a/m.txt")));
  CHECK_THROWS_AS(module->call("createFileSync", dynamic::array(data + "/a", "m.txt")), std::exception);
  module->call("copySync", dynamic::array(dynamic::object("from", file)("to", data + "/c.txt")));
  module->call("moveSync", dynamic::array(dynamic::object("from", data + "/c.txt")("to", data + "/d.txt")));
  CHECK(fs::file_size(dir.path / "data/d.txt") == 4);
  CHECK_FALSE(fs::exists(dir.path / "data/c.txt"));

  CHECK(module->call("deleteSync", dynamic::array(file)) == dynamic(nullptr));
  CHECK_FALSE(fs::exists(dir.path / "data/a/n.txt"));
  CHECK_THROWS_WITH_AS(module->call("deleteSync", dynamic::array(file)), doctest::Contains("Nothing to delete"), std::exception);
  CHECK(module->call("deleteSync", dynamic::array(file, dynamic::object("idempotent", true))) == dynamic(nullptr));

  write(dir.path / "outside/r.txt", "read me");
  auto readOnly = ngn::fileUri((dir.path / "outside/r.txt").string());
  CHECK(module->call("readAsStringSync", dynamic::array(readOnly)) == dynamic("read me"));
  CHECK_THROWS_WITH_AS(module->call("writeAsStringSync", dynamic::array(readOnly, "x")), doctest::Contains("can only be read"),
                       std::exception);
  CHECK_THROWS_AS(module->call("statSync", dynamic::array(ngn::fileUri((dir.path / "home").string()))), std::exception);
  CHECK(fs::file_size(dir.path / "outside/r.txt") == 7);
}

TEST_CASE("FileChanges names what happened in a folder, pairing a rename's two events and remembering what it saw") {
  TempDir dir;
  write(dir.path / "changed.txt", "");
  write(dir.path / "from.txt", "");
  fs::create_directories(dir.path / "sub");
  write(dir.path / "sub/deep.txt", "");
  auto exists = [](const std::string &p) { return fs::exists(p); };
  auto at = [&](const char *name) { return (dir.path / name).string(); };
  using E = ngn::FileWatcher::Event;
  ngn::FileChanges tracker(dir.path.string(), exists);
  // Seen before the watch began, so not created now.
  write(dir.path / "changed.txt", "");
  auto changes = tracker.changes(

      {E{.path = at("new.txt"), .created = true, .modified = true},
       // FSEvents keeps a file's created flag on its later events.
       E{.path = at("changed.txt"), .created = true, .modified = true},
       E{.path = at("gone.txt"), .created = true, .removed = true},
       E{.path = at("from.txt"), .renamed = true},
       E{.path = at("to.txt"), .renamed = true},
       E{.path = at("moved-away.txt"), .renamed = true},
       E{.path = at("sub/deep.txt"), .modified = true}},
      [&](const std::string &p) {
        // The batch as the disk stands after it: new.txt and to.txt are there, from.txt is not.
        if (p == at("from.txt") || p == at("gone.txt") || p == at("moved-away.txt")) {
          return false;
        }
        return p == at("new.txt") || p == at("to.txt") || fs::exists(p);
      });
  CHECK(changes == dynamic::array(dynamic::object("type", "created")("uri", ngn::fileUri(at("new.txt"))),
                                  dynamic::object("type", "modified")("uri", ngn::fileUri(at("changed.txt"))),
                                  dynamic::object("type", "deleted")("uri", ngn::fileUri(at("gone.txt"))),
                                  dynamic::object("type", "renamed")("uri", ngn::fileUri(at("from.txt")))(
                                      "newUri", ngn::fileUri(at("to.txt"))),
                                  dynamic::object("type", "deleted")("uri", ngn::fileUri(at("moved-away.txt")))));

  // Written again, new.txt is modified; deleted and made again, it is created.
  auto later = tracker.changes({E{.path = at("new.txt"), .created = true, .modified = true}}, [](const std::string &) { return true; });
  CHECK(later == dynamic::array(dynamic::object("type", "modified")("uri", ngn::fileUri(at("new.txt")))));
  tracker.changes({E{.path = at("new.txt"), .removed = true}}, [](const std::string &) { return false; });
  auto again = tracker.changes({E{.path = at("new.txt"), .created = true}}, [](const std::string &) { return true; });
  CHECK(again == dynamic::array(dynamic::object("type", "created")("uri", ngn::fileUri(at("new.txt")))));

  // A watched file reports only itself, and where a rename took it.
  ngn::FileChanges fileTracker(at("from.txt"), exists);
  auto file = fileTracker.changes({E{.path = at("from.txt"), .renamed = true}, E{.path = at("to.txt"), .renamed = true},
                                   E{.path = at("changed.txt"), .modified = true}},
                                  [&](const std::string &p) { return p != at("from.txt"); });
  CHECK(file == dynamic::array(dynamic::object("type", "renamed")("uri", ngn::fileUri(at("from.txt")))(
                    "newUri", ngn::fileUri(at("to.txt")))));
}

TEST_CASE("FileSystem watches a path it can reach, reports its changes with the watch id, and stops") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto watcher = std::make_shared<FakeWatcher>();
  std::vector<std::pair<std::string, dynamic>> events;
  {
    auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()), watcher);
    module->setEmitter([&](const std::string &name, dynamic body) { events.emplace_back(name, body); });
    CHECK(module->call("watch", dynamic::array(ngn::fileUri((dir.path / "outside").string()))) == dynamic(nullptr));
    CHECK(module->call("watch", dynamic::array(ngn::fileUri(folders.cache + "/missing"))) == dynamic(nullptr));
    CHECK(watcher->watches.empty());

    // As `paths` gives it, with a trailing slash.
    auto id = module->call("watch", dynamic::array(ngn::fileUri(folders.cache) + "/"));
    REQUIRE(id.isInt());
    REQUIRE(watcher->watches.size() == 1);
    CHECK(watcher->watches.begin()->second.first == folders.cache);
    write(dir.path / "cache/x.txt", "");
    watcher->watches.begin()->second.second({{.path = folders.cache + "/x.txt", .created = true}});
    REQUIRE(events.size() == 1);
    CHECK(events[0].first == "ngNativeFileSystem");
    CHECK(events[0].second ==
          dynamic::object("watch", id)("type", "created")("uri", ngn::fileUri(folders.cache + "/x.txt")));

    module->call("unwatch", dynamic::array(id));
    CHECK(watcher->watches.empty());
    module->call("watch", dynamic::array(ngn::fileUri(folders.cache)));
    CHECK(watcher->watches.size() == 1);
  }
  // The module going, as on a reload, stops what it started.
  CHECK(watcher->watches.empty());
}

namespace {

// Bookmarks that are the path they point at, with the moves the test makes, and a count of
// accesses started and not stopped.
struct FakeBookmarks final : ngn::Bookmarks {
  std::map<std::string, std::string> moved;
  std::set<std::string> gone;
  std::set<std::string> stale;
  std::map<std::string, int> open;
  std::vector<std::string> log;
  bool refuse{false};

  std::optional<std::string> make(const std::string &path) override {
    return "bm:" + path;
  }
  std::optional<Resolved> resolve(const std::string &bookmark) override {
    auto path = bookmark.substr(3);
    if (gone.count(path)) {
      return std::nullopt;
    }
    if (moved.count(path)) {
      return Resolved{.path = moved[path], .stale = true};
    }
    return Resolved{.path = path, .stale = stale.count(path) > 0};
  }
  bool startAccess(const std::string &bookmark) override {
    if (refuse) {
      return false;
    }
    open[bookmark]++;
    log.push_back("start " + bookmark);
    return true;
  }
  void stopAccess(const std::string &bookmark) override {
    open[bookmark]--;
    log.push_back("stop " + bookmark);
  }
  int opened() const {
    int count = 0;
    for (const auto &[bookmark, n] : open) {
      count += n;
    }
    return count;
  }
};

struct Saved {
  std::optional<std::string> text;
  int saves{0};
  ngn::PickStore::Persistence persistence() {
    return {
        .load = [this] { return text; },
        .save =
            [this](const std::string &json) {
              text = json;
              saves++;
            },
    };
  }
};

} // namespace

TEST_CASE("picks are kept across launches through their bookmarks, and reachable again") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto picked = (dir.path / "outside").string();
  write(dir.path / "outside/note.md", "kept");
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();

  // The first launch: the user picks a folder outside the app's own.
  {
    auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
    access->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
    access->allowPicked(picked);
    CHECK(access->accessTo(picked + "/note.md") == Access::ReadWrite);
  }
  REQUIRE(saved.text.has_value());
  auto json = folly::parseJson(*saved.text);
  CHECK(json["version"] == 1);
  CHECK(json["picks"][0]["path"] == picked);

  // The next launch: reachable before anything is picked, opened only around each call.
  auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
  CHECK(access->accessTo(picked + "/note.md") == Access::None);
  access->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
  CHECK(access->accessTo(picked + "/note.md") == Access::ReadWrite);
  auto module = ngn::makeFileSystemModule(access, std::make_shared<FakeWatcher>());
  bookmarks->log.clear();
  CHECK(module->call("readAsStringSync", dynamic::array(ngn::fileUri(picked + "/note.md"))) == dynamic("kept"));
  CHECK(bookmarks->log == std::vector<std::string>{"start bm:" + picked, "stop bm:" + picked});
  // The app's own folders are not picks.
  bookmarks->log.clear();
  module->call("writeAsStringSync", dynamic::array(ngn::fileUri(folders.document + "/a.txt"), "x"));
  CHECK(bookmarks->log.empty());
  // A failing call stops what it started too.
  CHECK_THROWS_AS(module->call("readAsStringSync", dynamic::array(ngn::fileUri(picked + "/missing.md"))), std::exception);
  CHECK(bookmarks->opened() == 0);
}

TEST_CASE("a pick that moved is found where it is now, and one that is gone is forgotten") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto first = (dir.path / "outside/a").string();
  auto second = (dir.path / "outside/b").string();
  auto third = (dir.path / "outside/c").string();
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  {
    ngn::PickStore store(saved.persistence(), bookmarks);
    store.remember(first);
    store.remember(second);
    store.remember(third);
    // Picked again: one entry, with a new bookmark.
    store.remember(first);
  }
  CHECK(folly::parseJson(*saved.text)["picks"].size() == 3);

  bookmarks->moved[first] = (dir.path / "outside/a-renamed").string();
  bookmarks->gone.insert(second);
  int before = saved.saves;
  ngn::PickStore store(saved.persistence(), bookmarks);
  auto paths = store.restore();
  CHECK(paths == std::vector<std::string>{(dir.path / "outside/a-renamed").string(), third});
  CHECK(saved.saves == before + 1);
  auto json = folly::parseJson(*saved.text);
  REQUIRE(json["picks"].size() == 2);
  CHECK(json["picks"][0]["path"] == (dir.path / "outside/a-renamed").string());
  // Made again where it is now.
  CHECK(json["picks"][0]["bookmark"] == ngn::base64Encode("bm:" + (dir.path / "outside/a-renamed").string()));

  // A pick gone with nothing else changed is forgotten too.
  bookmarks->moved.clear();
  bookmarks->gone.insert(third);
  {
    int saves = saved.saves;
    ngn::PickStore forgetting(saved.persistence(), bookmarks);
    CHECK(forgetting.restore().size() == 1);
    CHECK(saved.saves == saves + 1);
    CHECK(folly::parseJson(*saved.text)["picks"].size() == 1);
  }
  bookmarks->gone.clear();

  // Nothing changed: nothing is written.
  ngn::PickStore again(saved.persistence(), bookmarks);
  int saves = saved.saves;
  again.restore();
  CHECK(saved.saves == saves);
}

TEST_CASE("the innermost pick holding a path opens it, and a store that does not parse holds nothing") {
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  ngn::PickStore store(saved.persistence(), bookmarks);
  store.remember("/Users/a/Projects");
  store.remember("/Users/a/Projects/site");
  CHECK(store.bookmarkFor("/Users/a/Projects/site/index.html") == "bm:/Users/a/Projects/site");
  CHECK(store.bookmarkFor("/Users/a/Projects/other") == "bm:/Users/a/Projects");
  CHECK_FALSE(store.bookmarkFor("/Users/a/Projectsx").has_value());
  CHECK_FALSE(store.bookmarkFor("/Users/b").has_value());

  for (const char *text : {"not json", "[]", R"({"version": 2, "picks": []})", R"({"version": 1, "picks": [{"path": 1}]})"}) {
    Saved bad;
    bad.text = text;
    ngn::PickStore broken(bad.persistence(), bookmarks);
    CHECK(broken.restore().empty());
  }
}

TEST_CASE("a watch keeps its pick open until it stops, and a refused start opens nothing") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto picked = (dir.path / "outside").string();
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
  access->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
  access->allowPicked(picked);
  auto watcher = std::make_shared<FakeWatcher>();
  {
    auto module = ngn::makeFileSystemModule(access, watcher);
    auto id = module->call("watch", dynamic::array(ngn::fileUri(picked)));
    REQUIRE(id.isNumber());
    CHECK(bookmarks->opened() == 1);
    module->call("unwatch", dynamic::array(id));
    CHECK(bookmarks->opened() == 0);
    module->call("watch", dynamic::array(ngn::fileUri(picked)));
    CHECK(bookmarks->opened() == 1);
  }
  // The module going away stops the watches it still had.
  CHECK(bookmarks->opened() == 0);

  bookmarks->refuse = true;
  auto use = access->use(picked + "/x");
  CHECK_FALSE(use.started());
}
