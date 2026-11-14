#include "ngn/sqlite.h"

#include "ngn/bytes.h"

#include <sqlite3.h>

#include <cmath>
#include <filesystem>
#include <map>
#include <mutex>
#include <stdexcept>

namespace fs = std::filesystem;

namespace ngn {

namespace {

struct SqlError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

std::string stringArg(const folly::dynamic &args, size_t index) {
  return args.size() > index && args[index].isString() ? args[index].asString() : std::string{};
}

// A path or a file:// uri, as a directory argument may be.
std::string pathOf(std::string where) {
  constexpr std::string_view scheme = "file://";
  if (where.starts_with(scheme)) {
    where.erase(0, scheme.size());
  }
  return where;
}

// The file a database name names in `directory`, refusing one that would leave it.
fs::path fileFor(const std::string &name, const std::string &directory) {
  fs::path relative(name);
  if (name.empty() || relative.is_absolute()) {
    throw SqlError("Invalid database name '" + name + "': it must be a file name inside the database directory");
  }
  for (const auto &part : relative) {
    if (part == "..") {
      throw SqlError("Invalid database name '" + name + "': it must be a file name inside the database directory");
    }
  }
  return fs::path(directory) / relative;
}

class Statement {
 public:
  Statement(sqlite3 *db, const std::string &source) : db_(db) {
    if (sqlite3_prepare_v2(db, source.c_str(), static_cast<int>(source.size()), &stmt_, nullptr) != SQLITE_OK) {
      throw SqlError(failure(db));
    }
    if (!stmt_) {
      throw SqlError("The statement is empty");
    }
  }
  ~Statement() {
    sqlite3_finalize(stmt_);
  }
  Statement(const Statement &) = delete;
  Statement &operator=(const Statement &) = delete;

  void bind(const folly::dynamic &params) {
    if (params.isArray()) {
      // One past the statement's params fails to bind (SQLITE_RANGE).
      for (size_t i = 0; i < params.size(); i++) {
        bindOne(static_cast<int>(i) + 1, params[i]);
      }
    } else if (params.isObject()) {
      for (const auto &[key, value] : params.items()) {
        if (!key.isString()) {
          continue;
        }
        if (int index = sqlite3_bind_parameter_index(stmt_, key.asString().c_str())) {
          bindOne(index, value);
        }
      }
    } else if (!params.isNull()) {
      bindOne(1, params);
    }
  }

  // Steps once: a row, or false at the end.
  bool step() {
    int code = sqlite3_step(stmt_);
    if (code == SQLITE_ROW) {
      return true;
    }
    if (code == SQLITE_DONE) {
      return false;
    }
    throw SqlError(failure(db_));
  }

  folly::dynamic row() const {
    folly::dynamic row = folly::dynamic::object();
    for (int i = 0, n = sqlite3_column_count(stmt_); i < n; i++) {
      row[sqlite3_column_name(stmt_, i)] = column(i);
    }
    return row;
  }

  static std::string failure(sqlite3 *db) {
    return "Error code " + std::to_string(sqlite3_extended_errcode(db)) + ": " + sqlite3_errmsg(db);
  }

 private:
  void bindOne(int index, const folly::dynamic &value) {
    int code = SQLITE_OK;
    if (value.isNull()) {
      code = sqlite3_bind_null(stmt_, index);
    } else if (value.isBool()) {
      code = sqlite3_bind_int64(stmt_, index, value.asBool() ? 1 : 0);
    } else if (value.isInt()) {
      code = sqlite3_bind_int64(stmt_, index, value.asInt());
    } else if (value.isDouble()) {
      // JavaScript's numbers are all doubles: a whole one binds as an integer, as it was written.
      double number = value.asDouble();
      if (std::trunc(number) == number && std::abs(number) < 9007199254740992.0) {
        code = sqlite3_bind_int64(stmt_, index, static_cast<sqlite3_int64>(number));
      } else {
        code = sqlite3_bind_double(stmt_, index, number);
      }
    } else if (value.isString()) {
      const auto &text = value.getString();
      code = sqlite3_bind_text(stmt_, index, text.data(), static_cast<int>(text.size()), SQLITE_TRANSIENT);
    } else if (value.isObject() && value.count("base64") && value["base64"].isString()) {
      auto bytes = base64Decode(value["base64"].asString());
      if (!bytes) {
        throw SqlError("A blob param's base64 is not valid");
      }
      code = sqlite3_bind_blob64(stmt_, index, bytes->data(), bytes->size(), SQLITE_TRANSIENT);
    } else {
      throw SqlError("A param must be null, a boolean, a number, a string or {base64}");
    }
    if (code != SQLITE_OK) {
      throw SqlError(failure(db_));
    }
  }

  folly::dynamic column(int i) const {
    switch (sqlite3_column_type(stmt_, i)) {
      case SQLITE_INTEGER:
        return static_cast<int64_t>(sqlite3_column_int64(stmt_, i));
      case SQLITE_FLOAT:
        return sqlite3_column_double(stmt_, i);
      case SQLITE_TEXT:
        return std::string(
            reinterpret_cast<const char *>(sqlite3_column_text(stmt_, i)), static_cast<size_t>(sqlite3_column_bytes(stmt_, i)));
      case SQLITE_BLOB: {
        auto data = static_cast<const char *>(sqlite3_column_blob(stmt_, i));
        std::string bytes(data ? data : "", static_cast<size_t>(sqlite3_column_bytes(stmt_, i)));
        return folly::dynamic::object("base64", base64Encode(bytes));
      }
      default:
        return nullptr;
    }
  }

  sqlite3 *db_;
  sqlite3_stmt *stmt_{nullptr};
};

class Databases {
 public:
  explicit Databases(std::string defaultDirectory) : defaultDirectory_(std::move(defaultDirectory)) {}
  ~Databases() {
    for (auto &[id, open] : open_) {
      sqlite3_close_v2(open.db);
    }
  }

  const std::string &defaultDirectory() const {
    return defaultDirectory_;
  }

  folly::dynamic open(const folly::dynamic &args) {
    auto name = stringArg(args, 0);
    std::string path = ":memory:";
    if (name != ":memory:") {
      auto file = fileFor(name, directoryArg(args, 2));
      fs::create_directories(file.parent_path());
      path = file.string();
    }
    sqlite3 *db = nullptr;
    int code = sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr);
    if (code != SQLITE_OK) {
      std::string message = db ? Statement::failure(db) : "Error code " + std::to_string(code);
      sqlite3_close_v2(db);
      throw SqlError("Could not open database '" + name + "': " + message);
    }
    if (path != ":memory:") {
      sqlite3_exec(db, "PRAGMA journal_mode = WAL", nullptr, nullptr, nullptr);
    }
    std::lock_guard lock(mutex_);
    int id = ++next_;
    open_[id] = Open{.db = db, .path = path};
    return folly::dynamic::object("id", id)("databasePath", path)("databaseName", name);
  }

  void close(const folly::dynamic &args) {
    std::lock_guard lock(mutex_);
    auto it = open_.find(idOf(args));
    if (it == open_.end()) {
      throw SqlError("The database is closed");
    }
    sqlite3_close_v2(it->second.db);
    open_.erase(it);
  }

  void remove(const folly::dynamic &args) {
    auto name = stringArg(args, 0);
    auto file = fileFor(name, directoryArg(args, 1));
    {
      std::lock_guard lock(mutex_);
      for (const auto &[id, open] : open_) {
        if (open.path == file.string()) {
          throw SqlError("Unable to delete database '" + name + "' that is currently open. Close it before deleting it.");
        }
      }
    }
    if (!fs::exists(file)) {
      throw SqlError("Database '" + name + "' not found");
    }
    fs::remove(file);
    for (const char *suffix : {"-wal", "-shm", "-journal"}) {
      fs::remove(file.string() + suffix);
    }
  }

  sqlite3 *db(const folly::dynamic &args) {
    std::lock_guard lock(mutex_);
    auto it = open_.find(idOf(args));
    if (it == open_.end()) {
      throw SqlError("The database is closed");
    }
    return it->second.db;
  }

 private:
  struct Open {
    sqlite3 *db;
    std::string path;
  };

  std::string directoryArg(const folly::dynamic &args, size_t index) const {
    auto directory = stringArg(args, index);
    return directory.empty() ? defaultDirectory_ : pathOf(directory);
  }

  static int idOf(const folly::dynamic &args) {
    return !args.empty() && args[0].isNumber() ? static_cast<int>(args[0].asDouble()) : 0;
  }

  std::string defaultDirectory_;
  std::mutex mutex_;
  std::map<int, Open> open_;
  int next_{0};
};

folly::dynamic paramsOf(const folly::dynamic &args) {
  return args.size() > 2 ? args[2] : folly::dynamic(nullptr);
}

void exec(sqlite3 *db, const std::string &source) {
  char *error = nullptr;
  if (sqlite3_exec(db, source.c_str(), nullptr, nullptr, &error) != SQLITE_OK) {
    std::string message = "Error code " + std::to_string(sqlite3_extended_errcode(db)) + ": " + (error ? error : "");
    sqlite3_free(error);
    throw SqlError(message);
  }
}

folly::dynamic run(sqlite3 *db, const folly::dynamic &args) {
  Statement statement(db, stringArg(args, 1));
  statement.bind(paramsOf(args));
  while (statement.step()) {
  }
  return folly::dynamic::object("lastInsertRowId", static_cast<int64_t>(sqlite3_last_insert_rowid(db)))(
      "changes", sqlite3_changes(db));
}

folly::dynamic rows(sqlite3 *db, const folly::dynamic &args, bool firstOnly) {
  Statement statement(db, stringArg(args, 1));
  statement.bind(paramsOf(args));
  folly::dynamic all = folly::dynamic::array();
  while (statement.step()) {
    if (firstOnly) {
      return statement.row();
    }
    all.push_back(statement.row());
  }
  return firstOnly ? folly::dynamic(nullptr) : all;
}

} // namespace

std::shared_ptr<NativeModule> makeSqliteModule(std::string defaultDatabaseDirectory) {
  struct Sqlite : NativeModule {
    explicit Sqlite(std::string directory)
        : NativeModule("NgNativeSqlite"), databases(std::make_shared<Databases>(std::move(directory))) {
      auto dbs = databases;
      property("defaultDatabaseDirectory", [dbs] { return folly::dynamic(dbs->defaultDirectory()); });
      constants([dbs] { return folly::dynamic::object("defaultDatabaseDirectory", dbs->defaultDirectory()); });

      // Each call as a promise and as a synchronous method, over one function.
      auto both = [this](const std::string &name, std::function<folly::dynamic(const folly::dynamic &)> fn) {
        promise(name + "Async", [fn](const folly::dynamic &args, JsPromise promise) {
          folly::dynamic value;
          try {
            value = fn(args);
          } catch (const std::exception &error) {
            promise.reject(error.what());
            return;
          }
          promise.resolve(std::move(value));
        });
        sync(name + "Sync", fn);
      };
      both("openDatabase", [dbs](const folly::dynamic &args) { return dbs->open(args); });
      both("close", [dbs](const folly::dynamic &args) {
        dbs->close(args);
        return folly::dynamic(nullptr);
      });
      both("deleteDatabase", [dbs](const folly::dynamic &args) {
        dbs->remove(args);
        return folly::dynamic(nullptr);
      });
      both("exec", [dbs](const folly::dynamic &args) {
        exec(dbs->db(args), stringArg(args, 1));
        return folly::dynamic(nullptr);
      });
      both("run", [dbs](const folly::dynamic &args) { return run(dbs->db(args), args); });
      both("getFirst", [dbs](const folly::dynamic &args) { return rows(dbs->db(args), args, true); });
      both("getAll", [dbs](const folly::dynamic &args) { return rows(dbs->db(args), args, false); });
      both("isInTransaction", [dbs](const folly::dynamic &args) {
        return folly::dynamic(sqlite3_get_autocommit(dbs->db(args)) == 0);
      });
    }
    std::shared_ptr<Databases> databases;
  };
  return std::make_shared<Sqlite>(std::move(defaultDatabaseDirectory));
}

} // namespace ngn
