#include "ngn/sqlite.h"

#include <doctest/doctest.h>
#include <sqlite3.h>

#include <filesystem>
#include <optional>
#include <random>

using folly::dynamic;
namespace fs = std::filesystem;

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

// A folder of its own for each test, removed however the test ends.
struct TempDir {
  fs::path path;
  TempDir() {
    std::random_device random;
    path = fs::temp_directory_path() / ("ngn-sqlite-" + std::to_string(random()));
    fs::remove_all(path);
  }
  ~TempDir() {
    std::error_code ignored;
    fs::remove_all(path, ignored);
  }
};

dynamic open(const ngn::NativeModule &module, const std::string &name) {
  auto answer = ask(module, "openDatabaseAsync", dynamic::array(name));
  REQUIRE(answer.value);
  return (*answer.value)["id"];
}

} // namespace

TEST_CASE("Sqlite opens a database in its default folder, runs statements and reads rows back") {
  TempDir dir;
  auto module = ngn::makeSqliteModule((dir.path / "SQLite").string());
  CHECK(module->property("defaultDatabaseDirectory") == dynamic((dir.path / "SQLite").string()));

  auto opened = ask(*module, "openDatabaseAsync", dynamic::array("notes.db"));
  REQUIRE(opened.value);
  CHECK((*opened.value)["databasePath"] == dynamic((dir.path / "SQLite" / "notes.db").string()));
  CHECK((*opened.value)["databaseName"] == dynamic("notes.db"));
  CHECK(fs::exists(dir.path / "SQLite" / "notes.db"));
  auto id = (*opened.value)["id"];
  CHECK(module->call("getFirstSync", dynamic::array(id, "PRAGMA journal_mode")) == dynamic::object("journal_mode", "wal"));

  CHECK(ask(*module, "execAsync", dynamic::array(id, "CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT, score REAL);"
                                                     "INSERT INTO note (body, score) VALUES ('first', 1.5);"))
            .value == dynamic(nullptr));
  auto run = ask(*module, "runAsync", dynamic::array(id, "INSERT INTO note (body, score) VALUES (?, ?)", dynamic::array("second", 2)));
  REQUIRE(run.value);
  CHECK((*run.value)["lastInsertRowId"] == dynamic(2));
  CHECK((*run.value)["changes"] == dynamic(1));

  auto all = ask(*module, "getAllAsync", dynamic::array(id, "SELECT id, body, score FROM note ORDER BY id"));
  REQUIRE(all.value);
  CHECK(*all.value == dynamic::array(dynamic::object("id", 1)("body", "first")("score", 1.5),
                                     dynamic::object("id", 2)("body", "second")("score", 2.0)));
  auto first = ask(*module, "getFirstAsync", dynamic::array(id, "SELECT body FROM note WHERE id = ?", dynamic::array(2)));
  CHECK(first.value == dynamic(dynamic::object("body", "second")));
  CHECK(ask(*module, "getFirstAsync", dynamic::array(id, "SELECT body FROM note WHERE id = 99")).value == dynamic(nullptr));

  // The synchronous calls answer the same.
  CHECK(module->call("getAllSync", dynamic::array(id, "SELECT count(*) AS n FROM note")) ==
        dynamic::array(dynamic::object("n", 2)));
  CHECK(module->call("runSync", dynamic::array(id, "DELETE FROM note WHERE id = 1"))["changes"] == dynamic(1));
  CHECK(module->call("getFirstSync", dynamic::array(id, "SELECT count(*) AS n FROM note")) == dynamic::object("n", 1));
}

TEST_CASE("Sqlite binds named params as written, booleans as integers, and bytes as {base64} both ways") {
  TempDir dir;
  auto module = ngn::makeSqliteModule(dir.path.string());
  auto id = open(*module, ":memory:");
  module->call("execSync", dynamic::array(id, "CREATE TABLE t (a, b, c, d)"));
  module->call("runSync", dynamic::array(id, "INSERT INTO t VALUES ($a, :b, @c, $d)",
                                         dynamic::object("$a", true)(":b", nullptr)("@c", dynamic::object("base64", "AAEC/w=="))(
                                             "$d", "x")));
  CHECK(module->call("getFirstSync", dynamic::array(id, "SELECT a, b, c, d FROM t")) ==
        dynamic::object("a", 1)("b", nullptr)("c", dynamic::object("base64", "AAEC/w=="))("d", "x"));
  CHECK(module->call("getFirstSync", dynamic::array(id, "SELECT length(c) AS n FROM t")) == dynamic::object("n", 4));

  // Positional `?NNN`, and a param the statement does not have.
  CHECK(module->call("getFirstSync", dynamic::array(id, "SELECT ?2 AS two, ?1 AS one", dynamic::array("a", "b"))) ==
        dynamic::object("two", "b")("one", "a"));
  // JavaScript's numbers arrive as doubles: a whole one binds as an integer.
  CHECK(module->call("getFirstSync", dynamic::array(id, "SELECT typeof(?) AS a, typeof(?) AS b", dynamic::array(2.0, 2.5))) ==
        dynamic::object("a", "integer")("b", "real"));
  auto extra = ask(*module, "getFirstAsync", dynamic::array(id, "SELECT 1", dynamic::array(1)));
  CHECK(extra.error);
}

TEST_CASE("Sqlite reports SQL errors and calls on a closed database, and knows when it is in a transaction") {
  TempDir dir;
  auto module = ngn::makeSqliteModule(dir.path.string());
  auto id = open(*module, "t.db");
  auto bad = ask(*module, "execAsync", dynamic::array(id, "SELEKT 1"));
  REQUIRE(bad.error);
  CHECK(bad.error->find("syntax error") != std::string::npos);
  CHECK(ask(*module, "runAsync", dynamic::array(id, "INSERT INTO missing VALUES (1)")).error);

  CHECK(module->call("isInTransactionSync", dynamic::array(id)) == dynamic(false));
  module->call("execSync", dynamic::array(id, "BEGIN"));
  CHECK(ask(*module, "isInTransactionAsync", dynamic::array(id)).value == dynamic(true));
  module->call("execSync", dynamic::array(id, "ROLLBACK"));
  CHECK(module->call("isInTransactionSync", dynamic::array(id)) == dynamic(false));

  CHECK(ask(*module, "closeAsync", dynamic::array(id)).value == dynamic(nullptr));
  CHECK(ask(*module, "execAsync", dynamic::array(id, "SELECT 1")).error);
  CHECK(ask(*module, "closeAsync", dynamic::array(id)).error);
  CHECK_THROWS(module->call("getAllSync", dynamic::array(id, "SELECT 1")));
}

TEST_CASE("Sqlite keeps two opens of one file apart, and refuses to delete a database that is open") {
  TempDir dir;
  auto module = ngn::makeSqliteModule(dir.path.string());
  auto a = open(*module, "shared.db");
  auto b = open(*module, "shared.db");
  CHECK(a != b);
  module->call("execSync", dynamic::array(a, "CREATE TABLE t (x); INSERT INTO t VALUES (7)"));
  CHECK(module->call("getFirstSync", dynamic::array(b, "SELECT x FROM t")) == dynamic::object("x", 7));

  CHECK(ask(*module, "deleteDatabaseAsync", dynamic::array("shared.db")).error);
  module->call("closeSync", dynamic::array(a));
  CHECK(ask(*module, "deleteDatabaseAsync", dynamic::array("shared.db")).error);
  module->call("closeSync", dynamic::array(b));
  CHECK(ask(*module, "deleteDatabaseAsync", dynamic::array("shared.db")).value == dynamic(nullptr));
  CHECK_FALSE(fs::exists(dir.path / "shared.db"));
  CHECK_FALSE(fs::exists(dir.path / "shared.db-wal"));
  CHECK(ask(*module, "deleteDatabaseAsync", dynamic::array("shared.db")).error);
}

TEST_CASE("Sqlite opens and deletes in the folder a call names") {
  TempDir dir;
  auto module = ngn::makeSqliteModule((dir.path / "default").string());
  auto other = (dir.path / "elsewhere").string();
  auto opened = module->call("openDatabaseSync", dynamic::array("x.db", dynamic::object(), other));
  CHECK(opened["databasePath"] == dynamic((dir.path / "elsewhere" / "x.db").string()));
  module->call("closeSync", dynamic::array(opened["id"]));
  CHECK(module->call("deleteDatabaseSync", dynamic::array("x.db", other)) == dynamic(nullptr));
  CHECK_FALSE(fs::exists(dir.path / "elsewhere" / "x.db"));
  CHECK_FALSE(fs::exists(dir.path / "default"));
}

TEST_CASE("Sqlite refuses a name that leaves its folder") {
  TempDir dir;
  auto module = ngn::makeSqliteModule((dir.path / "SQLite").string());
  for (const char *name : {"", "../escape.db", "a/../../escape.db", "/etc/passwd"}) {
    CAPTURE(name);
    CHECK(ask(*module, "openDatabaseAsync", dynamic::array(name)).error);
    CHECK(ask(*module, "deleteDatabaseAsync", dynamic::array(name)).error);
  }
  CHECK_FALSE(fs::exists(dir.path / "escape.db"));
}

// Whether a fresh connection to `file` can start writing: not while another connection holds a
// write transaction on it.
bool canWriteAlone(const fs::path &file) {
  sqlite3 *db = nullptr;
  REQUIRE(sqlite3_open(file.c_str(), &db) == SQLITE_OK);
  bool ok = sqlite3_exec(db, "BEGIN IMMEDIATE; ROLLBACK", nullptr, nullptr, nullptr) == SQLITE_OK;
  sqlite3_close(db);
  return ok;
}

TEST_CASE("Sqlite closes every database it opened when the module goes, as on a reload") {
  TempDir dir;
  {
    auto module = ngn::makeSqliteModule(dir.path.string());
    auto id = open(*module, "kept.db");
    module->call("execSync", dynamic::array(id, "CREATE TABLE t (x); BEGIN; INSERT INTO t VALUES (1)"));
    CHECK_FALSE(canWriteAlone(dir.path / "kept.db"));
  }
  CHECK(canWriteAlone(dir.path / "kept.db"));
}
