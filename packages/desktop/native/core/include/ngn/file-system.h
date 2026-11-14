// NgNativeFileSystem: files for @ng-native/expo's FileSystem on a desktop OS. A TurboModule cannot
// hand JavaScript expo-file-system's File and Directory classes, so this answers flat calls over
// uris (expo-file-system/legacy's, and the service's own readdir, stat and watch), and the desktop
// loader builds the classes over them.
//
// - `paths`: {cache, document, appData, temp, home, desktop, downloads}, each a file:// uri ending
//   in `/`, and each left out where the app cannot reach it. `documentDirectory` and
//   `cacheDirectory` are legacy's two.
// - readdir(uri): [{name, uri, directory}] by name; stat(uri): {uri, directory, size, modified,
//   created} in ms since 1970, or null where nothing is.
// - watch(uri): a watch id, or null where nothing is; its changes arrive as `ngNativeFileSystem`
//   on DeviceEventEmitter: {watch, type: created | modified | deleted | renamed, uri, newUri?}, for
//   a file, or for a folder and what is directly in it. unwatch(id) stops one.
// - readAsStringAsync(uri, {encoding: utf8 | base64}), writeAsStringAsync(uri, text, {encoding,
//   append}), deleteAsync(uri, {idempotent}), makeDirectoryAsync(uri, {intermediates}),
//   moveAsync({from, to}), copyAsync({from, to}) and createFile(folderUri, name): {uri}, empty.
// - Each of those is synchronous too, with `Async` (or nothing) swapped for `Sync`: statSync,
//   readdirSync, readAsStringSync, writeAsStringSync, deleteSync, makeDirectorySync, moveSync,
//   copySync and createFileSync answer the same value, or throw the failure the promise rejects
//   with. The service's files are synchronous through them, as expo-file-system's are.
//
// Every call is checked against FileAccess: the app's own folders and what the user picked can be
// read and written, and anything else only as the plugin options' `capabilities.paths` declare
// (`read` or `readwrite`). Symbolic links are followed before the check, so one cannot lead out.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace ngn {

// A path as a file:// uri, percent-encoded as expo-file-system writes them.
std::string fileUri(const std::string &path);
// The absolute path a file:// uri or a plain absolute path names, percent-decoded. Nothing for
// another scheme or a relative path.
std::optional<std::string> pathOfUri(const std::string &uri);

class FileAccess {
 public:
  enum class Access { None, Read, ReadWrite };

  struct Folders {
    std::string cache;
    std::string document;
    std::string appData;
    std::string temp;
    // The user's: reachable only as `paths` declares them.
    std::string home;
    std::string desktop;
    std::string downloads;
  };

  // `declared` is `capabilities.paths`: [{path, access}], `~/` meaning the home folder.
  FileAccess(Folders folders, const folly::dynamic &declared);

  const Folders &folders() const {
    return folders_;
  }
  // What the app may do at `path`, an absolute path.
  Access accessTo(const std::string &path) const;
  // A file or folder the user chose in a panel, for the rest of the process.
  void allowPicked(const std::string &path);

 private:
  struct Root {
    std::string path;
    Access access;
  };
  void add(const std::string &path, Access access);

  Folders folders_;
  mutable std::mutex mutex_;
  std::vector<Root> roots_;
};

// The OS's file events (FSEvents on macOS), for one path at a time.
class FileWatcher {
 public:
  // One event as the OS reports it; the flags may be several at once, coalesced.
  struct Event {
    std::string path;
    bool created{false};
    bool removed{false};
    bool renamed{false};
    bool modified{false};
  };
  virtual ~FileWatcher() = default;
  // Starts reporting batches of events under `path`, on any thread, until stop. A handle.
  virtual int start(const std::string &path, std::function<void(std::vector<Event>)> events) = 0;
  virtual void stop(int handle) = 0;
};

// The changes batches of events make to `watched` (a file, or a folder and what is directly in
// it), as `ngNativeFileSystem` reports them without the watch id. It remembers the paths it has
// seen, from those there when the watch began, since FSEvents keeps a file's created flag on its
// later events. `exists` says whether a path is there now: what coalesced flags cannot.
class FileChanges {
 public:
  using Exists = std::function<bool(const std::string &)>;
  FileChanges(std::string watched, const Exists &exists);
  folly::dynamic changes(const std::vector<FileWatcher::Event> &events, const Exists &exists);

 private:
  bool concerns(const std::string &path) const;
  std::string watched_;
  bool folder_{false};
  std::set<std::string> seen_;
};

std::shared_ptr<NativeModule> makeFileSystemModule(std::shared_ptr<FileAccess> access, std::shared_ptr<FileWatcher> watcher);

} // namespace ngn
