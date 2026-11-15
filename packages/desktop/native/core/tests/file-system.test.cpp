#include "helpers.h"
#include "ngn/file-system.h"
#include "ngn/input-dispatcher.h"
#include "ngn/web-view.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <map>
#include <random>
#include <set>
#include <utility>

#include <unistd.h>

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
  // A batch sent from inside start, before the watch's id is answered.
  std::vector<Event> early;
  // The OS would not start the watch.
  bool refuse{false};
  int start(const std::string &path, std::function<void(std::vector<Event>)> events) override {
    if (refuse) {
      return 0;
    }
    if (!early.empty()) {
      events(std::exchange(early, {}));
    }
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

TEST_CASE("replaceFile writes through no entry already at its temporary file's name") {
  TempDir dir;
  write(dir.path / "victim.txt", "kept");
  // The temporary name is the target's with the process id and a count: an entry put at each of
  // the next names, here a link to another file, is never opened, written or removed.
  auto target = dir.path / "note.txt";
  auto prefix = target.string() + ".part-" + std::to_string(::getpid()) + "-";
  constexpr int planted = 4096;
  for (int n = 1; n <= planted; n++) {
    fs::create_symlink(dir.path / "victim.txt", prefix + std::to_string(n));
  }
  CHECK_FALSE(ngn::replaceFile(target.string(), "overwrite"));
  std::ifstream victim(dir.path / "victim.txt");
  std::string text((std::istreambuf_iterator<char>(victim)), std::istreambuf_iterator<char>());
  CHECK(text == "kept");
  CHECK_FALSE(fs::exists(fs::symlink_status(target)));
  int links = 0;
  for (int n = 1; n <= planted; n++) {
    links += fs::is_symlink(fs::symlink_status(prefix + std::to_string(n))) ? 1 : 0;
  }
  CHECK(links == planted);

  // With the names free it writes as before.
  for (int n = 1; n <= planted; n++) {
    fs::remove(prefix + std::to_string(n));
  }
  CHECK(ngn::replaceFile(target.string(), "written"));
  std::ifstream written(target);
  CHECK(std::string((std::istreambuf_iterator<char>(written)), std::istreambuf_iterator<char>()) == "written");
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

TEST_CASE("FileSystem checks the path a call uses, not one a symbolic link and .. would lead to") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  // outside/link is data/sub: outside/link/.. is data to the OS, and outside once .. is taken away.
  fs::create_directories(dir.path / "data/sub");
  write(dir.path / "outside/secret.txt", "secret");
  write(dir.path / "data/secret.txt", "mine");
  fs::create_directory_symlink(dir.path / "data/sub", dir.path / "outside/link");
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()),
                                          std::make_shared<FakeWatcher>());
  auto through = ngn::fileUri((dir.path / "outside/link/../secret.txt").string());
  auto read = ask(*module, "readAsStringAsync", dynamic::array(through));
  CHECK(read.error);
  CHECK_FALSE(read.value);
  CHECK(ask(*module, "deleteAsync", dynamic::array(through)).error);
  CHECK(fs::exists(dir.path / "outside/secret.txt"));

  // Within reach too: data/link/.. is data/sub to the OS, and data without the link. A call never
  // acts on a file the path does not name.
  fs::create_directories(dir.path / "data/sub/nested");
  write(dir.path / "data/sub/secret.txt", "sub");
  fs::create_directory_symlink(dir.path / "data/sub/nested", dir.path / "data/link");
  auto data = ngn::fileUri(folders.appData);
  CHECK(ask(*module, "deleteAsync", dynamic::array(data + "/link/../secret.txt")).error);
  CHECK(fs::exists(dir.path / "data/secret.txt"));
  CHECK(fs::exists(dir.path / "data/sub/secret.txt"));
  CHECK(ask(*module, "writeAsStringAsync", dynamic::array(data + "/link/../new.txt", "x")).error);
  CHECK_FALSE(fs::exists(dir.path / "data/new.txt"));
  // A .. that means the same either way, and a link as the last part, still work.
  CHECK(ask(*module, "readAsStringAsync", dynamic::array(data + "/sub/nested/../secret.txt")).value == dynamic("sub"));
  CHECK(ask(*module, "deleteAsync", dynamic::array(data + "/link")).value == dynamic(nullptr));
  CHECK_FALSE(fs::exists(fs::symlink_status(dir.path / "data/link")));
  CHECK(fs::is_directory(dir.path / "data/sub/nested"));
}

TEST_CASE("FileSystem tells apart two final links to one file after a .. through a link") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  // data/secret and data/sub/secret are both links to target.txt, and data/link is data/sub/nested:
  // data/link/../secret is data/sub/secret to the OS, and data/secret once .. is taken away. Both
  // resolve to target.txt, so only the entries themselves tell them apart.
  fs::create_directories(dir.path / "data/sub/nested");
  write(dir.path / "data/target.txt", "target");
  fs::create_symlink(dir.path / "data/target.txt", dir.path / "data/secret");
  fs::create_symlink(dir.path / "data/target.txt", dir.path / "data/sub/secret");
  fs::create_directory_symlink(dir.path / "data/sub/nested", dir.path / "data/link");
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()),
                                          std::make_shared<FakeWatcher>());
  auto data = ngn::fileUri(folders.appData);
  CHECK(ask(*module, "deleteAsync", dynamic::array(data + "/link/../secret")).error);
  CHECK(fs::is_symlink(fs::symlink_status(dir.path / "data/secret")));
  CHECK(fs::is_symlink(fs::symlink_status(dir.path / "data/sub/secret")));
  CHECK(ask(*module, "moveAsync",
            dynamic::array(dynamic::object("from", data + "/link/../secret")("to", data + "/moved")))
            .error);
  CHECK(fs::is_symlink(fs::symlink_status(dir.path / "data/sub/secret")));
}

TEST_CASE("FileSystem copies a folder's symbolic links as links, and never writes through one out of reach") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  write(dir.path / "outside/secret.txt", "secret");
  write(dir.path / "data/src/a.txt", "a");
  fs::create_symlink(dir.path / "outside/secret.txt", dir.path / "data/src/link");
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()),
                                          std::make_shared<FakeWatcher>());
  auto data = ngn::fileUri(folders.appData);
  CHECK(ask(*module, "copyAsync", dynamic::array(dynamic::object("from", data + "/src")("to", data + "/dst"))).value ==
        dynamic(nullptr));
  CHECK(fs::is_regular_file(fs::symlink_status(dir.path / "data/dst/a.txt")));
  CHECK(fs::is_symlink(fs::symlink_status(dir.path / "data/dst/link")));
  CHECK(ask(*module, "readAsStringAsync", dynamic::array(data + "/dst/link")).error);

  // A link at the destination that points out of reach is not written through.
  write(dir.path / "outside/kept.txt", "kept");
  fs::create_directories(dir.path / "data/into");
  fs::create_symlink(dir.path / "outside/kept.txt", dir.path / "data/into/a.txt");
  write(dir.path / "data/only/a.txt", "overwrite");
  CHECK(ask(*module, "copyAsync", dynamic::array(dynamic::object("from", data + "/only")("to", data + "/into"))).error);
  std::ifstream kept(dir.path / "outside/kept.txt");
  std::string text((std::istreambuf_iterator<char>(kept)), std::istreambuf_iterator<char>());
  CHECK(text == "kept");

  // A file copied onto a folder lands in it.
  fs::create_directories(dir.path / "data/folder");
  CHECK(ask(*module, "copyAsync", dynamic::array(dynamic::object("from", data + "/src/a.txt")("to", data + "/folder")))
            .value == dynamic(nullptr));
  CHECK(fs::is_regular_file(dir.path / "data/folder/a.txt"));

  // A folder is never copied into itself or a folder inside it, however the path names it, and
  // into a folder beside it whose name it begins.
  write(dir.path / "data/tree/a.txt", "a");
  for (const char *into : {"/tree", "/tree/inner", "/tree/./inner/", "/other/../tree/deep/er"}) {
    CAPTURE(into);
    CHECK(ask(*module, "copyAsync", dynamic::array(dynamic::object("from", data + "/tree")("to", data + into))).error);
  }
  CHECK_FALSE(fs::exists(dir.path / "data/tree/inner"));
  CHECK_FALSE(fs::exists(dir.path / "data/tree/deep"));
  CHECK(ask(*module, "copyAsync", dynamic::array(dynamic::object("from", data + "/tree")("to", data + "/tree2"))).value ==
        dynamic(nullptr));
  CHECK(fs::is_regular_file(dir.path / "data/tree2/a.txt"));
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

TEST_CASE("a change the watcher sends before the watch's id is answered goes out with that id") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto watcher = std::make_shared<FakeWatcher>();
  std::vector<dynamic> events;
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()), watcher);
  module->setEmitter([&](const std::string &, dynamic body) { events.push_back(body); });
  write(dir.path / "cache/early.txt", "");
  watcher->early = {{.path = folders.cache + "/early.txt", .created = true}};
  auto id = module->call("watch", dynamic::array(ngn::fileUri(folders.cache)));
  REQUIRE(id.isInt());
  REQUIRE(events.size() == 1);
  CHECK(events[0]["watch"] == id);
  CHECK(events[0]["uri"] == dynamic(ngn::fileUri(folders.cache + "/early.txt")));
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
  // A renewal is told apart from a new bookmark; refused, it makes none.
  bool refuseRenew{false};
  std::optional<std::string> renew(const std::string &bookmark, const std::string &path) override {
    log.push_back("renew " + bookmark);
    if (refuseRenew) {
      return std::nullopt;
    }
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

TEST_CASE("readFor lets a module read a file JavaScript names where FileSystem could, and the app bundle's assets") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  fs::create_directories(dir.path / "App.app/Contents/Resources/assets");
  folders.bundle = (dir.path / "App.app/Contents/Resources").string();
  write(dir.path / "home/Desktop/shot.png", "png");
  write(dir.path / "home/Downloads/kept.png", "png");
  write(dir.path / "outside/picked.png", "png");
  ngn::FileAccess access(folders, dynamic::array(dynamic::object("path", "~/Downloads")("access", "read")));

  // The app's own folders, a declared path, a pick and the bundle's assets.
  CHECK(access.readFor(folders.cache + "/ImageManipulator/a.png") != nullptr);
  CHECK(access.readFor(folders.temp + "/b.png") != nullptr);
  CHECK(access.readFor((dir.path / "home/Downloads/kept.png").string()) != nullptr);
  CHECK(access.readFor(folders.bundle + "/assets/logo.png") != nullptr);
  CHECK_THROWS_AS(access.readFor((dir.path / "outside/picked.png").string()), ngn::FileRefused);
  access.allowPicked((dir.path / "outside/picked.png").string());
  CHECK(access.readFor((dir.path / "outside/picked.png").string()) != nullptr);

  // The bundle is for assets: FileSystem itself still cannot reach it.
  CHECK(access.accessTo(folders.bundle + "/assets/logo.png") == Access::None);

  // Anything else is refused, with the same words whether or not a file is there.
  std::string there;
  std::string missing;
  try {
    access.readFor((dir.path / "home/Desktop/shot.png").string());
  } catch (const ngn::FileRefused &refused) {
    there = refused.what();
  }
  try {
    access.readFor((dir.path / "home/Desktop/none.png").string());
  } catch (const ngn::FileRefused &refused) {
    missing = refused.what();
  }
  CHECK(there.find("outside the files this app may read") != std::string::npos);
  CHECK(there.find("shot.png") != std::string::npos);
  CHECK(missing.find("outside the files this app may read") != std::string::npos);
  CHECK(missing.substr(missing.find(" is outside")) == there.substr(there.find(" is outside")));
  // A link out of the app's folders, a way up and a relative path are refused too.
  fs::create_directory_symlink(dir.path / "home/Desktop", dir.path / "data/desk");
  CHECK_THROWS_AS(access.readFor((dir.path / "data/desk/shot.png").string()), ngn::FileRefused);
  CHECK_THROWS_AS(access.readFor((dir.path / "data/../home/Desktop/shot.png").string()), ngn::FileRefused);
  CHECK_THROWS_AS(access.readFor((dir.path / "App.app/Contents/Resources/../../../home/Desktop/shot.png").string()), ngn::FileRefused);
  CHECK_THROWS_AS(access.readFor("relative.png"), ngn::FileRefused);
}

TEST_CASE("writeFor lets a module write where FileSystem could, and nowhere it could only read") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  fs::create_directories(dir.path / "App.app/Contents/Resources");
  folders.bundle = (dir.path / "App.app/Contents/Resources").string();
  ngn::FileAccess access(folders, dynamic::array(dynamic::object("path", "~/Downloads")("access", "read"),
                                                 dynamic::object("path", "~/Desktop")("access", "readwrite")));

  CHECK(access.writeFor(folders.appData + "/SQLite/notes.db") != nullptr);
  CHECK(access.writeFor(folders.document + "/new/notes.db") != nullptr);
  CHECK(access.writeFor((dir.path / "home/Desktop/notes.db").string()) != nullptr);
  access.allowPicked((dir.path / "outside").string());
  CHECK(access.writeFor((dir.path / "outside/notes.db").string()) != nullptr);

  // Read-only declarations, the bundle, anything else and a way out are refused, in one set of words.
  std::string readOnly;
  try {
    access.writeFor((dir.path / "home/Downloads/notes.db").string());
  } catch (const ngn::FileRefused &refused) {
    readOnly = refused.what();
  }
  CHECK(readOnly.find("outside the files this app may write") != std::string::npos);
  CHECK_THROWS_AS(access.writeFor(folders.bundle + "/notes.db"), ngn::FileRefused);
  CHECK_THROWS_AS(access.writeFor((dir.path / "home/notes.db").string()), ngn::FileRefused);
  CHECK_THROWS_AS(access.writeFor(folders.appData + "/../home/notes.db"), ngn::FileRefused);
  CHECK_THROWS_AS(access.writeFor("notes.db"), ngn::FileRefused);
}

TEST_CASE("readableSource checks a file source with readFor and hands on exactly the file it checked") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  fs::create_directories(dir.path / "App.app/Contents/Resources/assets");
  folders.bundle = (dir.path / "App.app/Contents/Resources").string();
  write(dir.path / "cache/a b.png", "png");
  write(dir.path / "home/Desktop/shot.png", "png");
  ngn::FileAccess access(folders, dynamic::array());

  // Other schemes pass as they are, with nothing to hold open.
  for (const char *uri : {"https://example.com/a.png", "http://localhost:8081/assets/a.png", "data:image/png;base64,AA=="}) {
    auto source = ngn::readableSource(&access, uri);
    CHECK(source.uri == uri);
    CHECK(source.use == nullptr);
  }
  // A file in the app's folders, the bundle's assets, and a plain path, each as the file uri of its path.
  auto cached = ngn::fileUri(folders.cache + "/a b.png");
  CHECK(ngn::readableSource(&access, cached).uri == cached);
  CHECK(ngn::readableSource(&access, cached).use != nullptr);
  CHECK(ngn::readableSource(&access, folders.cache + "/a b.png").uri == cached);
  CHECK(ngn::readableSource(&access, "FILE://" + folders.cache + "/a%20b.png").uri == cached);
  CHECK(ngn::readableSource(&access, ngn::fileUri(folders.bundle + "/assets/logo.png")).uri ==
        ngn::fileUri(folders.bundle + "/assets/logo.png"));
  // A query or fragment is not part of the file, and cannot walk the check somewhere else.
  CHECK(ngn::readableSource(&access, cached + "?v=2").uri == cached);
  auto desktop = ngn::fileUri((dir.path / "home/Desktop/shot.png").string());
  CHECK_THROWS_AS(ngn::readableSource(&access, desktop + "#/../../../cache/a.png"), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::readableSource(&access, desktop + "?/../../../cache/a.png"), ngn::FileRefused);

  // Outside the boundary, however the uri is spelled.
  CHECK_THROWS_AS(ngn::readableSource(&access, desktop), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::readableSource(&access, "File://" + (dir.path / "home/Desktop/shot.png").string()), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::readableSource(&access, (dir.path / "home/Desktop/shot.png").string()), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::readableSource(&access, "file:" + (dir.path / "home/Desktop/shot.png").string()), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::readableSource(&access, "file://localhost" + folders.cache + "/a%20b.png"), ngn::FileRefused);
  CHECK_THROWS_AS(ngn::readableSource(nullptr, cached), ngn::FileRefused);
}

TEST_CASE("The views' file access is the host's, and refuses every file until it is set") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  ngn::testing::ViewFileAccess restore(nullptr);
  CHECK_THROWS_AS(ngn::readableSource(ngn::viewFileAccess().get(), ngn::fileUri(folders.cache + "/a.png")), ngn::FileRefused);
  auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
  ngn::useViewFileAccess(access);
  CHECK(ngn::viewFileAccess() == access);
  CHECK(ngn::readableSource(ngn::viewFileAccess().get(), ngn::fileUri(folders.cache + "/a.png")).uri ==
        ngn::fileUri(folders.cache + "/a.png"));
}

TEST_CASE("readFor opens a pick of an earlier launch for as long as the module reads it") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto picked = (dir.path / "outside").string();
  write(dir.path / "outside/photo.png", "png");
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  {
    auto first = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
    first->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
    first->allowPicked(picked);
  }
  auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
  access->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
  bookmarks->log.clear();
  {
    auto use = access->readFor(picked + "/photo.png");
    CHECK(use->started());
    CHECK(bookmarks->log == std::vector<std::string>{"start bm:" + picked});
  }
  CHECK(bookmarks->log == std::vector<std::string>{"start bm:" + picked, "stop bm:" + picked});
  CHECK(bookmarks->opened() == 0);
}

TEST_CASE("a drag item holds a pick of an earlier launch open until whatever takes it lets it go") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto picked = (dir.path / "outside").string();
  write(dir.path / "outside/a.md", "a");
  write(dir.path / "outside/b.md", "b");
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  {
    auto first = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
    first->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
    first->allowPicked(picked);
  }
  auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
  access->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
  bookmarks->log.clear();
  {
    auto item = ngn::dragItemOf(
        dynamic::object("files", dynamic::array(ngn::fileUri(picked + "/a.md")))("url", ngn::fileUri(picked + "/b.md")),
        access.get());
    REQUIRE(item);
    // The drag reads the files after dragItemOf answers, so the picks stay open with the item.
    CHECK(bookmarks->opened() == 2);
    auto taken = std::move(*item);
    item.reset();
    CHECK(bookmarks->opened() == 2);
  }
  CHECK(bookmarks->opened() == 0);
  // A file in the app's own folders starts nothing.
  bookmarks->log.clear();
  CHECK(ngn::dragItemOf(dynamic::object("url", ngn::fileUri(folders.cache + "/c.md")), access.get()));
  CHECK(bookmarks->log.empty());
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

  // A stale pick whose bookmark cannot be renewed as it was keeps its bookmark.
  bookmarks->stale.insert(third);
  bookmarks->refuseRenew = true;
  {
    ngn::PickStore keeping(saved.persistence(), bookmarks);
    keeping.restore();
    CHECK(folly::parseJson(*saved.text)["picks"][2]["bookmark"] == ngn::base64Encode("bm:" + third));
    CHECK(std::count(bookmarks->log.begin(), bookmarks->log.end(), "renew bm:" + third) == 1);
  }
  bookmarks->stale.clear();
  bookmarks->refuseRenew = false;
  bookmarks->log.clear();

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
  // Renewed where it is now.
  CHECK(json["picks"][0]["bookmark"] == ngn::base64Encode("bm:" + (dir.path / "outside/a-renamed").string()));
  CHECK(bookmarks->log == std::vector<std::string>{"renew bm:" + first});

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

TEST_CASE("FileChanges lists the folder again when the OS dropped events, and reports what came and went") {
  TempDir dir;
  write(dir.path / "kept.txt", "");
  write(dir.path / "gone.txt", "");
  auto exists = [](const std::string &p) { return fs::exists(p); };
  auto at = [&](const char *name) { return (dir.path / name).string(); };
  using E = ngn::FileWatcher::Event;
  ngn::FileChanges tracker(dir.path.string(), exists);
  fs::remove(dir.path / "gone.txt");
  write(dir.path / "missed.txt", "");
  auto rescanned = tracker.changes({E{.path = dir.path.string(), .rescan = true}}, exists);
  CHECK(rescanned == dynamic::array(dynamic::object("type", "deleted")("uri", ngn::fileUri(at("gone.txt"))),
                                    dynamic::object("type", "created")("uri", ngn::fileUri(at("missed.txt")))));
  // Seen now: another rescan finds nothing new, and a later write is a modification.
  CHECK(tracker.changes({E{.path = dir.path.string(), .rescan = true}}, exists).empty());
  CHECK(tracker.changes({E{.path = at("missed.txt"), .modified = true}}, exists) ==
        dynamic::array(dynamic::object("type", "modified")("uri", ngn::fileUri(at("missed.txt")))));
}

TEST_CASE("FileChanges keeps what it saw when the folder cannot be listed, and lists it again at the next event") {
  TempDir dir;
  write(dir.path / "kept.txt", "");
  auto exists = [](const std::string &p) { return fs::exists(p); };
  auto at = [&](const char *name) { return (dir.path / name).string(); };
  using E = ngn::FileWatcher::Event;
  ngn::FileChanges tracker(dir.path.string(), exists);
  write(dir.path / "missed.txt", "");
  // Still there, but unreadable: an empty listing would report kept.txt deleted.
  fs::permissions(dir.path, fs::perms::owner_all, fs::perm_options::remove);
  folly::dynamic unreadable;
  try {
    unreadable = tracker.changes({E{.path = dir.path.string(), .rescan = true}}, exists);
  } catch (...) {
    fs::permissions(dir.path, fs::perms::owner_all, fs::perm_options::add);
    throw;
  }
  fs::permissions(dir.path, fs::perms::owner_all, fs::perm_options::add);
  CHECK(unreadable.empty());
  // Readable again: the next event, of any kind, brings the listing that was owed.
  CHECK(tracker.changes({E{.path = at("kept.txt"), .modified = true}}, exists) ==
        dynamic::array(dynamic::object("type", "created")("uri", ngn::fileUri(at("missed.txt"))),
                       dynamic::object("type", "modified")("uri", ngn::fileUri(at("kept.txt")))));
  CHECK(tracker.changes({E{.path = dir.path.string(), .rescan = true}}, exists).empty());
}

TEST_CASE("FileChanges reports a watched folder's entries deleted once a file takes its place") {
  TempDir dir;
  fs::create_directories(dir.path / "watched");
  write(dir.path / "watched/kept.txt", "");
  auto watched = (dir.path / "watched").string();
  auto exists = [](const std::string &p) { return fs::exists(p); };
  using E = ngn::FileWatcher::Event;
  ngn::FileChanges tracker(watched, exists);
  fs::remove_all(watched);
  write(watched, "a file now");
  // Not a folder that cannot be listed for now: what was in it is gone, and nothing is owed.
  CHECK(tracker.changes({E{.path = watched, .rescan = true}}, exists) ==
        dynamic::array(dynamic::object("type", "deleted")("uri", ngn::fileUri(watched + "/kept.txt"))));
  CHECK(tracker.changes({E{.path = watched, .modified = true}}, exists) ==
        dynamic::array(dynamic::object("type", "modified")("uri", ngn::fileUri(watched))));
}

TEST_CASE("FileChanges keeps what it saw when a folder it cannot list has a type it cannot read either") {
  TempDir dir;
  fs::create_directories(dir.path / "parent/watched");
  write(dir.path / "parent/watched/kept.txt", "");
  auto parent = dir.path / "parent";
  auto watched = (parent / "watched").string();
  // The first check found the folder there; the parent stops being searchable before the rest.
  auto there = [](const std::string &) { return std::optional<bool>(true); };
  auto exists = [](const std::string &p) { return fs::exists(p); };
  using E = ngn::FileWatcher::Event;
  ngn::FileChanges tracker(watched, exists);
  write(dir.path / "parent/watched/missed.txt", "");
  fs::permissions(parent, fs::perms::owner_exec, fs::perm_options::remove);
  folly::dynamic unknown;
  try {
    unknown = tracker.changes({E{.path = watched, .rescan = true}}, there);
  } catch (...) {
    fs::permissions(parent, fs::perms::owner_exec, fs::perm_options::add);
    throw;
  }
  fs::permissions(parent, fs::perms::owner_exec, fs::perm_options::add);
  // Not a confirmed removal: kept.txt is not reported deleted, and the listing is owed.
  CHECK(unknown.empty());
  CHECK(tracker.changes({E{.path = watched + "/kept.txt", .modified = true}}, exists) ==
        dynamic::array(dynamic::object("type", "created")("uri", ngn::fileUri(watched + "/missed.txt")),
                       dynamic::object("type", "modified")("uri", ngn::fileUri(watched + "/kept.txt"))));
}

TEST_CASE("FileChanges reports a watched folder and its entries deleted when it goes after the check that found it") {
  TempDir dir;
  fs::create_directories(dir.path / "watched");
  write(dir.path / "watched/kept.txt", "");
  auto watched = (dir.path / "watched").string();
  auto exists = [](const std::string &p) { return fs::exists(p); };
  auto there = [](const std::string &) { return std::optional<bool>(true); };
  using E = ngn::FileWatcher::Event;
  ngn::FileChanges tracker(watched, exists);
  fs::remove_all(watched);
  CHECK(tracker.changes({E{.path = watched, .rescan = true}}, there) ==
        dynamic::array(dynamic::object("type", "deleted")("uri", ngn::fileUri(watched)),
                       dynamic::object("type", "deleted")("uri", ngn::fileUri(watched + "/kept.txt"))));
  // Confirmed: nothing is owed.
  CHECK(tracker.changes({E{.path = watched, .rescan = true}}, exists).empty());
}

TEST_CASE("a folder that cannot be listed when the watch begins is no watch, and holds nothing open") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  write(fs::path(folders.cache) / "there.txt", "");
  auto watcher = std::make_shared<FakeWatcher>();
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()), watcher);
  // Its listing would start without there.txt, which a later write would report as created.
  fs::permissions(folders.cache, fs::perms::owner_all, fs::perm_options::remove);
  dynamic id;
  try {
    id = module->call("watch", dynamic::array(ngn::fileUri(folders.cache)));
  } catch (...) {
    fs::permissions(folders.cache, fs::perms::owner_all, fs::perm_options::add);
    throw;
  }
  fs::permissions(folders.cache, fs::perms::owner_all, fs::perm_options::add);
  CHECK(id == dynamic(nullptr));
  CHECK(watcher->watches.empty());
}

TEST_CASE("a watched folder's child event with search permission gone is unknown, not deleted, and listed again later") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto kept = folders.cache + "/kept.txt";
  write(kept, "");
  auto watcher = std::make_shared<FakeWatcher>();
  auto module = ngn::makeFileSystemModule(std::make_shared<ngn::FileAccess>(folders, dynamic::array()), watcher);
  std::vector<dynamic> events;
  module->setEmitter([&](const std::string &, dynamic body) { events.push_back(body); });
  auto id = module->call("watch", dynamic::array(ngn::fileUri(folders.cache)));
  REQUIRE(id.isInt());
  auto send = watcher->watches.begin()->second.second;
  // Listable, but nothing in it can be looked up: whether kept.txt is there is unknown.
  fs::permissions(folders.cache, fs::perms::owner_exec, fs::perm_options::remove);
  try {
    CHECK_NOTHROW(send({{.path = kept, .modified = true}}));
  } catch (...) {
    fs::permissions(folders.cache, fs::perms::owner_exec, fs::perm_options::add);
    throw;
  }
  fs::permissions(folders.cache, fs::perms::owner_exec, fs::perm_options::add);
  CHECK(events.empty());
  // Searchable again: the next event lists the folder again (nothing came or went) and is told.
  send({{.path = kept, .modified = true}});
  CHECK(events == std::vector<dynamic>{dynamic::object("watch", id)("type", "modified")("uri", ngn::fileUri(kept))});
}

TEST_CASE("a watch the OS would not start is no watch, and holds nothing open") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto picked = (dir.path / "outside").string();
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  auto access = std::make_shared<ngn::FileAccess>(folders, dynamic::array());
  access->keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
  access->allowPicked(picked);
  auto watcher = std::make_shared<FakeWatcher>();
  watcher->refuse = true;
  auto module = ngn::makeFileSystemModule(access, watcher);
  CHECK(module->call("watch", dynamic::array(ngn::fileUri(picked))) == dynamic(nullptr));
  CHECK(bookmarks->opened() == 0);
}

TEST_CASE("a web view page read with its folder holds the folder's pick open, not only its own") {
  TempDir dir;
  auto folders = foldersIn(dir.path);
  auto site = (dir.path / "outside/site").string();
  write(site + "/index.html", "<p>");
  write(site + "/style.css", "p{}");
  Saved saved;
  auto bookmarks = std::make_shared<FakeBookmarks>();
  ngn::FileAccess access(folders, dynamic::array());
  access.keepPicks(std::make_shared<ngn::PickStore>(saved.persistence(), bookmarks));
  access.allowPicked(site);
  access.allowPicked(site + "/index.html");
  {
    auto page = ngn::webViewFile(&access, ngn::fileUri(site + "/index.html"));
    REQUIRE(page);
    CHECK(page->readAccess == ngn::fileUri(site) + "/");
    CHECK(bookmarks->open["bm:" + site] == 1);
  }
  CHECK(bookmarks->opened() == 0);
}
