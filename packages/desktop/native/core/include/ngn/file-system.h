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

// The toolkit's security-scoped bookmarks (macOS): what finds a file or folder the user picked
// again in a later launch, wherever it has moved, and reopens the sandbox to it.
class Bookmarks {
 public:
  struct Resolved {
    std::string path;
    // The bookmark still resolves but should be made again.
    bool stale{false};
  };
  virtual ~Bookmarks() = default;
  // A bookmark for `path`, or nothing where the toolkit cannot make one.
  virtual std::optional<std::string> make(const std::string &path) = 0;
  // Where a bookmark points now, or nothing for one that no longer resolves.
  virtual std::optional<Resolved> resolve(const std::string &bookmark) = 0;
  // Starts and stops using what a bookmark points at. Each start the toolkit agreed to (true) is
  // matched by one stop; starts nest.
  virtual bool startAccess(const std::string &bookmark) = 0;
  virtual void stopAccess(const std::string &bookmark) = 0;
};

// The user's picks, kept across launches: a bookmark for each, stored through `load` and `save`
// (somewhere JavaScript cannot write, since a bookmark opens the sandbox) as JSON:
// {"version": 1, "picks": [{"path", "bookmark" (base64)}]}. Any thread.
class PickStore {
 public:
  struct Persistence {
    std::function<std::optional<std::string>()> load;
    std::function<void(const std::string &)> save;
  };
  PickStore(Persistence persistence, std::shared_ptr<Bookmarks> bookmarks);

  // The picks of earlier launches that still resolve, each at its path now. A stale bookmark is
  // made again and one that no longer resolves is dropped, and the store is saved when either
  // happens.
  std::vector<std::string> restore();
  // Keeps a pick for later launches; a path kept already gets a new bookmark.
  void remember(const std::string &path);
  // The bookmark of the innermost pick holding `path`.
  std::optional<std::string> bookmarkFor(const std::string &path) const;
  Bookmarks &bookmarks() const {
    return *bookmarks_;
  }

 private:
  struct Pick {
    std::string path;
    std::string bookmark;
  };
  void save();

  Persistence persistence_;
  std::shared_ptr<Bookmarks> bookmarks_;
  mutable std::mutex mutex_;
  std::vector<Pick> picks_;
};

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
  // A file or folder the user chose in a panel: for the rest of the process, and in later
  // launches once picks are kept.
  void allowPicked(const std::string &path);
  // Keeps the picks in `store` from now on, and allows the ones earlier launches kept.
  void keepPicks(std::shared_ptr<PickStore> store);

  // The pick holding a path opened for as long as this lives: a picked file or folder of an earlier
  // launch is reachable in the sandbox only while its bookmark's access is started.
  class Use {
   public:
    Use() = default;
    Use(std::shared_ptr<PickStore> store, std::string bookmark);
    Use(Use &&other) noexcept;
    Use &operator=(Use &&other) noexcept;
    Use(const Use &) = delete;
    Use &operator=(const Use &) = delete;
    ~Use();
    bool started() const {
      return store_ != nullptr;
    }

   private:
    void release();
    std::shared_ptr<PickStore> store_;
    std::string bookmark_;
  };
  // A Use for `path`; one that starts nothing outside picks.
  Use use(const std::string &path) const;

 private:
  struct Root {
    std::string path;
    Access access;
  };
  void add(const std::string &path, Access access);

  Folders folders_;
  mutable std::mutex mutex_;
  std::vector<Root> roots_;
  std::shared_ptr<PickStore> picks_;
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
