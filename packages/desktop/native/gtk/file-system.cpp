// GFileMonitor reports a rename within a watched folder as one event naming both paths, and a move
// across its edge as a move in or out; these become the core's events (FSEvents' shape: a rename
// is its old path, then its new one).
#include "file-system.h"

#include "app-windows.h"

#include <gio/gio.h>

#include <cstdio>
#include <cstdlib>
#include <functional>
#include <memory>
#include <map>
#include <mutex>
#include <sstream>

namespace ngn::gtk {

namespace {

std::string pathOf(GFile *file) {
  gchar *path = file ? g_file_get_path(file) : nullptr;
  std::string out = path ? path : "";
  g_free(path);
  return out;
}

// One watch: its monitor, made on the main context, and its events' handler, which runs only while
// the watch lasts. The lock is held across each batch, so once stop has taken it none follows.
struct Watch {
  std::recursive_mutex lock;
  bool live{true};
  GFileMonitor *monitor{nullptr};
  gulong handler{0};
  std::function<void(std::vector<FileWatcher::Event>)> events;
};

void changed(GFileMonitor *, GFile *file, GFile *other, GFileMonitorEvent type, gpointer data) {
  auto *watch = static_cast<Watch *>(data);
  std::vector<FileWatcher::Event> batch;
  auto path = pathOf(file);
  switch (type) {
    case G_FILE_MONITOR_EVENT_CREATED:
    case G_FILE_MONITOR_EVENT_MOVED_IN:
      batch.push_back({.path = path, .created = true});
      break;
    case G_FILE_MONITOR_EVENT_DELETED:
    case G_FILE_MONITOR_EVENT_MOVED_OUT:
      batch.push_back({.path = path, .removed = true});
      break;
    case G_FILE_MONITOR_EVENT_CHANGED:
    case G_FILE_MONITOR_EVENT_ATTRIBUTE_CHANGED:
      batch.push_back({.path = path, .modified = true});
      break;
    case G_FILE_MONITOR_EVENT_RENAMED:
      batch.push_back({.path = path, .renamed = true});
      batch.push_back({.path = pathOf(other), .renamed = true});
      break;
    case G_FILE_MONITOR_EVENT_UNMOUNTED:
      batch.push_back({.path = path, .rescan = true});
      break;
    default:
      // CHANGES_DONE_HINT follows the CHANGED already reported; PRE_UNMOUNT comes before UNMOUNTED.
      return;
  }
  std::lock_guard hold(watch->lock);
  if (watch->live) {
    watch->events(std::move(batch));
  }
}


class MonitorWatcher final : public FileWatcher {
 public:
  int start(const std::string &path, std::function<void(std::vector<Event>)> events) override {
    auto watch = std::make_shared<Watch>();
    watch->events = std::move(events);
    int handle;
    {
      std::lock_guard lock(mutex_);
      handle = ++next_;
      watches_[handle] = watch;
    }
    // On the main context, so its events are read there whichever thread asked.
    onMainContext([watch, path] {
      std::lock_guard hold(watch->lock);
      if (!watch->live) {
        return;
      }
      GFile *file = g_file_new_for_path(path.c_str());
      GError *error = nullptr;
      watch->monitor = g_file_monitor(file, G_FILE_MONITOR_WATCH_MOVES, nullptr, &error);
      g_object_unref(file);
      if (!watch->monitor) {
        fprintf(stderr, "[ngn] could not watch %s: %s\n", path.c_str(), error->message);
        g_error_free(error);
        return;
      }
      // FSEvents' latency: GIO's default holds a file's changes back for most of a second.
      g_file_monitor_set_rate_limit(watch->monitor, 100);
      watch->handler = g_signal_connect(watch->monitor, "changed", G_CALLBACK(changed), watch.get());
    });
    return handle;
  }

  void stop(int handle) override {
    std::shared_ptr<Watch> watch;
    {
      std::lock_guard lock(mutex_);
      auto it = watches_.find(handle);
      if (it == watches_.end()) {
        return;
      }
      watch = std::move(it->second);
      watches_.erase(it);
    }
    {
      std::lock_guard hold(watch->lock);
      watch->live = false;
    }
    onMainContext([watch] {
      if (watch->monitor) {
        g_signal_handler_disconnect(watch->monitor, watch->handler);
        g_file_monitor_cancel(watch->monitor);
        g_clear_object(&watch->monitor);
      }
    });
  }

 private:
  std::mutex mutex_;
  std::map<int, std::shared_ptr<Watch>> watches_;
  int next_{0};
};

std::string realOrSame(const std::string &path) {
  if (path.empty()) {
    return path;
  }
  char *resolved = realpath(path.c_str(), nullptr);
  std::string out = resolved ? resolved : path;
  free(resolved);
  return out;
}

} // namespace

std::shared_ptr<FileWatcher> makeFileWatcher() {
  return std::make_shared<MonitorWatcher>();
}

std::string xdgUserDir(const std::string &contents, const std::string &name, const std::string &home) {
  std::istringstream lines(contents);
  std::string line;
  std::string key = "XDG_" + name + "_DIR=";
  std::string found;
  while (std::getline(lines, line)) {
    auto start = line.find_first_not_of(" \t");
    if (start == std::string::npos || line.compare(start, key.size(), key) != 0) {
      continue;
    }
    auto value = line.substr(start + key.size());
    auto open = value.find('"');
    auto close = value.rfind('"');
    if (open == std::string::npos || close == open) {
      continue;
    }
    value = value.substr(open + 1, close - open - 1);
    if (value.rfind("$HOME", 0) == 0) {
      value = home + value.substr(5);
    } else if (value.empty() || value[0] != '/') {
      // The file allows only $HOME-relative and absolute paths.
      continue;
    }
    while (value.size() > 1 && value.back() == '/') {
      value.pop_back();
    }
    // The last line for a name wins, as xdg-user-dirs reads it.
    found = value;
  }
  auto bare = home;
  while (bare.size() > 1 && bare.back() == '/') {
    bare.pop_back();
  }
  return found == bare ? "" : found;
}

FileAccess::Folders fileFolders(const std::string &appData, const std::string &cache, const std::string &temp) {
  std::string home = g_get_home_dir();
  std::string contents;
  gchar *file = g_build_filename(g_get_user_config_dir(), "user-dirs.dirs", nullptr);
  gchar *text = nullptr;
  if (g_file_get_contents(file, &text, nullptr, nullptr)) {
    contents = text;
    g_free(text);
  }
  g_free(file);
  auto document = appData + "/Documents";
  g_mkdir_with_parents(document.c_str(), 0700);
  return {
      .cache = realOrSame(cache),
      .document = realOrSame(document),
      .appData = realOrSame(appData),
      .temp = realOrSame(temp),
      .home = realOrSame(home),
      .desktop = realOrSame(xdgUserDir(contents, "DESKTOP", home)),
      .downloads = realOrSame(xdgUserDir(contents, "DOWNLOAD", home)),
  };
}

} // namespace ngn::gtk
