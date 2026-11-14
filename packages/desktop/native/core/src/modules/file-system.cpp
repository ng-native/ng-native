#include "ngn/file-system.h"

#include "ngn/bytes.h"

#include <sys/stat.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <stdexcept>

namespace fs = std::filesystem;

namespace ngn {

std::string fileUri(const std::string &path) {
  static const char *hex = "0123456789ABCDEF";
  std::string out = "file://";
  for (unsigned char c : path) {
    if (std::isalnum(c) || c == '/' || c == '-' || c == '.' || c == '_' || c == '~') {
      out += static_cast<char>(c);
    } else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 15];
    }
  }
  return out;
}

std::optional<std::string> pathOfUri(const std::string &uri) {
  constexpr std::string_view scheme = "file://";
  if (uri.starts_with('/')) {
    return uri;
  }
  if (!uri.starts_with(scheme) || uri.size() == scheme.size() || uri[scheme.size()] != '/') {
    return std::nullopt;
  }
  std::string out;
  for (size_t i = scheme.size(); i < uri.size(); i++) {
    if (uri[i] == '%' && i + 2 < uri.size() && std::isxdigit(static_cast<unsigned char>(uri[i + 1])) &&
        std::isxdigit(static_cast<unsigned char>(uri[i + 2]))) {
      out += static_cast<char>(std::stoi(uri.substr(i + 1, 2), nullptr, 16));
      i += 2;
    } else {
      out += uri[i];
    }
  }
  return out;
}

namespace {

// The path with every symbolic link in the part that exists followed, and `.` and `..` gone.
std::string resolved(const std::string &path) {
  std::error_code error;
  auto out = fs::weakly_canonical(fs::path(path), error);
  return error ? fs::path(path).lexically_normal().string() : out.string();
}

bool inside(const std::string &path, const std::string &root) {
  return path == root || (path.starts_with(root) && (root.ends_with('/') || path[root.size()] == '/'));
}

} // namespace

FileAccess::FileAccess(Folders folders, const folly::dynamic &declared) : folders_(std::move(folders)) {
  for (const auto *own : {&folders_.cache, &folders_.document, &folders_.appData, &folders_.temp}) {
    add(*own, Access::ReadWrite);
  }
  if (!declared.isArray()) {
    return;
  }
  for (const auto &entry : declared) {
    if (!entry.isObject() || !entry.count("path") || !entry["path"].isString()) {
      continue;
    }
    auto path = entry["path"].asString();
    if (path == "~" || path.starts_with("~/")) {
      path = folders_.home + path.substr(1);
    }
    if (!path.starts_with('/')) {
      continue;
    }
    bool write = entry.count("access") && entry["access"] == "readwrite";
    add(path, write ? Access::ReadWrite : Access::Read);
  }
}

void FileAccess::add(const std::string &path, Access access) {
  if (path.empty()) {
    return;
  }
  std::lock_guard lock(mutex_);
  roots_.push_back({.path = resolved(path), .access = access});
}

void FileAccess::allowPicked(const std::string &path) {
  add(path, Access::ReadWrite);
}

FileAccess::Access FileAccess::accessTo(const std::string &path) const {
  if (!path.starts_with('/')) {
    return Access::None;
  }
  auto target = resolved(path);
  Access best = Access::None;
  std::lock_guard lock(mutex_);
  for (const auto &root : roots_) {
    if (inside(target, root.path) && root.access > best) {
      best = root.access;
    }
  }
  return best;
}

FileChanges::FileChanges(std::string watched, const Exists &exists) : watched_(std::move(watched)) {
  std::error_code error;
  folder_ = fs::is_directory(watched_, error);
  if (exists(watched_)) {
    seen_.insert(watched_);
  }
  if (folder_) {
    for (const auto &entry : fs::directory_iterator(watched_, error)) {
      seen_.insert(entry.path().string());
    }
  }
}

bool FileChanges::concerns(const std::string &path) const {
  return path == watched_ || (folder_ && fs::path(path).parent_path() == fs::path(watched_));
}

folly::dynamic FileChanges::changes(const std::vector<FileWatcher::Event> &events, const Exists &exists) {
  auto change = [](const char *type, const std::string &path) -> folly::dynamic {
    return folly::dynamic::object("type", type)("uri", fileUri(path));
  };
  folly::dynamic out = folly::dynamic::array();
  for (size_t i = 0; i < events.size(); i++) {
    const auto &event = events[i];
    bool here = exists(event.path);
    // FSEvents reports a rename as two events in a row: the old path, then the new one.
    if (event.renamed && !here && i + 1 < events.size() && events[i + 1].renamed && exists(events[i + 1].path)) {
      const auto &to = events[i + 1].path;
      i++;
      seen_.erase(event.path);
      bool known = seen_.contains(to);
      seen_.insert(to);
      if (concerns(event.path)) {
        auto renamed = change("renamed", event.path);
        renamed["newUri"] = fileUri(to);
        out.push_back(std::move(renamed));
      } else if (concerns(to)) {
        out.push_back(change(known ? "modified" : "created", to));
      }
      continue;
    }
    bool known = seen_.contains(event.path);
    if (here) {
      seen_.insert(event.path);
    } else {
      seen_.erase(event.path);
    }
    if (!concerns(event.path)) {
      continue;
    }
    if (!here) {
      out.push_back(change("deleted", event.path));
    } else if (!known) {
      out.push_back(change("created", event.path));
    } else {
      out.push_back(change("modified", event.path));
    }
  }
  return out;
}

namespace {

struct FileError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

std::string stringArg(const folly::dynamic &args, size_t index) {
  return args.size() > index && args[index].isString() ? args[index].asString() : std::string{};
}

const folly::dynamic &option(const folly::dynamic &args, size_t index, const char *key) {
  static const folly::dynamic none = nullptr;
  if (args.size() > index && args[index].isObject()) {
    if (const auto *value = args[index].get_ptr(key)) {
      return *value;
    }
  }
  return none;
}

bool flagOption(const folly::dynamic &args, size_t index, const char *key) {
  const auto &value = option(args, index, key);
  return value.isBool() && value.asBool();
}

int64_t millisSince1970(const struct timespec &time) {
  return static_cast<int64_t>(time.tv_sec) * 1000 + time.tv_nsec / 1000000;
}

folly::dynamic statOf(const std::string &uri, const std::string &path) {
  struct stat info {};
  if (::stat(path.c_str(), &info) != 0) {
    return nullptr;
  }
  bool directory = S_ISDIR(info.st_mode);
#if defined(__APPLE__)
  folly::dynamic modified = millisSince1970(info.st_mtimespec);
  folly::dynamic created = millisSince1970(info.st_birthtimespec);
#else
  folly::dynamic modified = millisSince1970(info.st_mtim);
  folly::dynamic created = nullptr;
#endif
  return folly::dynamic::object("uri", uri)("directory", directory)(
      "size", directory ? int64_t{0} : static_cast<int64_t>(info.st_size))("modified", modified)("created", created);
}

std::string readAll(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    throw FileError("The file could not be read: " + path);
  }
  std::ostringstream bytes;
  bytes << in.rdbuf();
  return bytes.str();
}

// The open watches and where their changes go, outliving the module for a callback in flight.
struct WatchSink {
  std::mutex mutex;
  bool open{true};
  std::function<void(folly::dynamic)> emit;
};

} // namespace

std::shared_ptr<NativeModule> makeFileSystemModule(std::shared_ptr<FileAccess> access, std::shared_ptr<FileWatcher> watcher) {
  struct FileSystem : NativeModule {
    std::shared_ptr<FileWatcher> watcher;
    std::shared_ptr<WatchSink> sink = std::make_shared<WatchSink>();
    std::mutex watchesMutex;
    std::vector<int> watches;

    FileSystem(std::shared_ptr<FileAccess> access, std::shared_ptr<FileWatcher> fileWatcher)
        : NativeModule("NgNativeFileSystem"), watcher(std::move(fileWatcher)) {
      sink->emit = [this](folly::dynamic body) { emit("ngNativeFileSystem", std::move(body)); };

      // The path a uri names, when the app may do `needed` there.
      auto reach = [access](const std::string &uri, FileAccess::Access needed) {
        auto path = pathOfUri(uri);
        if (!path) {
          throw FileError("Not a file uri or an absolute path: " + uri);
        }
        auto had = access->accessTo(*path);
        if (had < needed) {
          throw FileError(
              *path +
              (had == FileAccess::Access::Read
                   ? " can only be read: declare it with access 'readwrite' in the @ng-native/desktop plugin's capabilities.paths."
                   : " is outside the folders the app can reach: declare it in the @ng-native/desktop plugin's capabilities.paths."));
        }
        // No trailing slash, so a folder's path compares equal however its uri was written.
        auto normal = fs::path(*path).lexically_normal().string();
        if (normal.size() > 1 && normal.ends_with('/')) {
          normal.pop_back();
        }
        return normal;
      };
      constexpr auto Read = FileAccess::Access::Read;
      constexpr auto Write = FileAccess::Access::ReadWrite;

      auto paths = [access] {
        const auto &f = access->folders();
        folly::dynamic out = folly::dynamic::object();
        for (const auto &[name, path] : std::vector<std::pair<const char *, std::string>>{
                 {"cache", f.cache}, {"document", f.document}, {"appData", f.appData}, {"temp", f.temp},
                 {"home", f.home}, {"desktop", f.desktop}, {"downloads", f.downloads}}) {
          if (!path.empty() && access->accessTo(path) != FileAccess::Access::None) {
            out[name] = fileUri(path) + "/";
          }
        }
        return out;
      };
      property("paths", paths);
      property("documentDirectory", [access] { return folly::dynamic(fileUri(access->folders().document) + "/"); });
      property("cacheDirectory", [access] { return folly::dynamic(fileUri(access->folders().cache) + "/"); });
      constants([paths, access] {
        return folly::dynamic::object("paths", paths())("documentDirectory", fileUri(access->folders().document) + "/")(
            "cacheDirectory", fileUri(access->folders().cache) + "/");
      });

      // A promise over a function that throws its failure.
      auto answer = [this](const std::string &name, std::function<folly::dynamic(const folly::dynamic &)> fn) {
        promise(name, [fn = std::move(fn)](const folly::dynamic &args, JsPromise promise) {
          folly::dynamic value;
          try {
            value = fn(args);
          } catch (const std::exception &error) {
            promise.reject(error.what());
            return;
          }
          promise.resolve(std::move(value));
        });
      };

      answer("readdir", [reach](const folly::dynamic &args) {
        auto path = reach(stringArg(args, 0), Read);
        if (!fs::is_directory(path)) {
          throw FileError("Not a folder: " + path);
        }
        std::vector<fs::directory_entry> entries(fs::directory_iterator(path), fs::directory_iterator{});
        std::sort(entries.begin(), entries.end(), [](const auto &a, const auto &b) { return a.path().filename() < b.path().filename(); });
        folly::dynamic out = folly::dynamic::array();
        for (const auto &entry : entries) {
          out.push_back(folly::dynamic::object("name", entry.path().filename().string())("uri", fileUri(entry.path().string()))(
              "directory", entry.is_directory()));
        }
        return out;
      });
      answer("stat", [reach](const folly::dynamic &args) {
        auto uri = stringArg(args, 0);
        return statOf(uri, reach(uri, Read));
      });
      answer("readAsStringAsync", [reach](const folly::dynamic &args) {
        auto bytes = readAll(reach(stringArg(args, 0), Read));
        return folly::dynamic(option(args, 1, "encoding") == "base64" ? base64Encode(bytes) : bytes);
      });
      answer("writeAsStringAsync", [reach](const folly::dynamic &args) {
        auto path = reach(stringArg(args, 0), Write);
        std::string bytes = stringArg(args, 1);
        if (option(args, 2, "encoding") == "base64") {
          auto decoded = base64Decode(bytes);
          if (!decoded) {
            throw FileError("The contents are not base64");
          }
          bytes = std::move(*decoded);
        }
        std::ofstream out(path, std::ios::binary | (flagOption(args, 2, "append") ? std::ios::app : std::ios::trunc));
        out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!out) {
          throw FileError("The file could not be written: " + path);
        }
        return folly::dynamic(nullptr);
      });
      answer("deleteAsync", [reach](const folly::dynamic &args) {
        auto path = reach(stringArg(args, 0), Write);
        if (!fs::exists(fs::symlink_status(path))) {
          if (flagOption(args, 1, "idempotent")) {
            return folly::dynamic(nullptr);
          }
          throw FileError("Nothing to delete at " + path);
        }
        fs::remove_all(path);
        return folly::dynamic(nullptr);
      });
      answer("makeDirectoryAsync", [reach](const folly::dynamic &args) {
        auto path = reach(stringArg(args, 0), Write);
        if (flagOption(args, 1, "intermediates")) {
          fs::create_directories(path);
        } else if (!fs::create_directory(path)) {
          throw FileError("The folder is there already: " + path);
        }
        return folly::dynamic(nullptr);
      });
      answer("moveAsync", [reach](const folly::dynamic &args) {
        auto from = reach(option(args, 0, "from").isString() ? option(args, 0, "from").asString() : "", Write);
        auto to = reach(option(args, 0, "to").isString() ? option(args, 0, "to").asString() : "", Write);
        fs::rename(from, to);
        return folly::dynamic(nullptr);
      });
      answer("copyAsync", [reach](const folly::dynamic &args) {
        auto from = reach(option(args, 0, "from").isString() ? option(args, 0, "from").asString() : "", Read);
        auto to = reach(option(args, 0, "to").isString() ? option(args, 0, "to").asString() : "", Write);
        fs::copy(from, to, fs::copy_options::recursive | fs::copy_options::overwrite_existing);
        return folly::dynamic(nullptr);
      });
      answer("createFile", [reach](const folly::dynamic &args) {
        auto folder = reach(stringArg(args, 0), Write);
        auto name = stringArg(args, 1);
        if (name.empty() || name == "." || name == ".." || name.find('/') != std::string::npos) {
          throw FileError("Not a file name: " + name);
        }
        if (!fs::is_directory(folder)) {
          throw FileError("Not a folder: " + folder);
        }
        auto path = (fs::path(folder) / name).string();
        // "x" fails when the file is there, rather than emptying it.
        FILE *file = std::fopen(path.c_str(), "wx");
        if (!file) {
          throw FileError("The file could not be created (it may be there already): " + path);
        }
        std::fclose(file);
        return folly::dynamic::object("uri", fileUri(path));
      });

      sync("watch", [this, reach](const folly::dynamic &args) -> folly::dynamic {
        std::string path;
        try {
          path = reach(stringArg(args, 0), Read);
        } catch (const FileError &) {
          return nullptr;
        }
        if (!fs::exists(path)) {
          return nullptr;
        }
        auto id = std::make_shared<int>(0);
        auto exists = [](const std::string &p) { return fs::exists(fs::symlink_status(p)); };
        // Called on the watcher's own serial queue, one batch at a time.
        auto tracker = std::make_shared<FileChanges>(path, exists);
        int handle = watcher->start(path, [sink = sink, tracker, exists, id](std::vector<FileWatcher::Event> events) {
          auto changes = tracker->changes(events, exists);
          std::lock_guard lock(sink->mutex);
          if (!sink->open) {
            return;
          }
          for (auto &change : changes) {
            change["watch"] = *id;
            sink->emit(std::move(change));
          }
        });
        *id = handle;
        std::lock_guard lock(watchesMutex);
        watches.push_back(handle);
        return handle;
      });
      sync("unwatch", [this](const folly::dynamic &args) -> folly::dynamic {
        if (args.empty() || !args[0].isNumber()) {
          return nullptr;
        }
        int handle = static_cast<int>(args[0].asDouble());
        {
          std::lock_guard lock(watchesMutex);
          auto it = std::find(watches.begin(), watches.end(), handle);
          if (it == watches.end()) {
            return nullptr;
          }
          watches.erase(it);
        }
        watcher->stop(handle);
        return nullptr;
      });
    }

    ~FileSystem() override {
      {
        std::lock_guard lock(sink->mutex);
        sink->open = false;
      }
      for (int handle : watches) {
        watcher->stop(handle);
      }
    }
  };
  return std::make_shared<FileSystem>(std::move(access), std::move(watcher));
}

} // namespace ngn
