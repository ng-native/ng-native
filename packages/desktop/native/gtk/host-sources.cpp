#include "host-sources.h"

#include "app-windows.h"

#include <adwaita.h>
#include <gtk/gtk.h>

#include <sys/utsname.h>

#include <atomic>
#include <cstdio>
#include <mutex>

namespace ngn::gtk {

namespace {

class KeyFileStore final : public StringStore {
 public:
  explicit KeyFileStore(std::string path) : path_(std::move(path)), file_(g_key_file_new()) {
    g_key_file_load_from_file(file_, path_.c_str(), G_KEY_FILE_NONE, nullptr);
  }
  ~KeyFileStore() override {
    g_key_file_free(file_);
  }
  std::optional<std::string> get(const std::string &key) override {
    std::lock_guard lock(mutex_);
    gchar *value = g_key_file_get_string(file_, kGroup, key.c_str(), nullptr);
    if (!value) {
      return std::nullopt;
    }
    std::string out = value;
    g_free(value);
    return out;
  }
  void set(const std::string &key, const std::string &value) override {
    std::lock_guard lock(mutex_);
    g_key_file_set_string(file_, kGroup, key.c_str(), value.c_str());
    save();
  }
  void remove(const std::string &key) override {
    std::lock_guard lock(mutex_);
    g_key_file_remove_key(file_, kGroup, key.c_str(), nullptr);
    save();
  }

 private:
  static constexpr const char *kGroup = "Preferences";
  void save() {
    gchar *dir = g_path_get_dirname(path_.c_str());
    g_mkdir_with_parents(dir, 0700);
    g_free(dir);
    GError *error = nullptr;
    if (!g_key_file_save_to_file(file_, path_.c_str(), &error)) {
      fprintf(stderr, "[ngn] preferences: %s\n", error->message);
      g_error_free(error);
    }
  }
  std::string path_;
  GKeyFile *file_;
  std::mutex mutex_;
};

using ImageSize = std::optional<std::pair<double, double>>;

void sizePrepared(GdkPixbufLoader *, int width, int height, gpointer out) {
  *static_cast<ImageSize *>(out) = std::make_pair<double, double>(width, height);
}

std::string systemScheme() {
  return adw_style_manager_get_dark(adw_style_manager_get_default()) ? "dark" : "light";
}

class GtkSystem final : public System {
 public:
  GtkSystem(const std::string &appId, std::string appData)
      : appData_(std::move(appData)),
        preferences_(makeKeyFileStore(appData_ + "/preferences.ini"), appId, false),
        scheme_(systemScheme()) {
    g_signal_connect(adw_style_manager_get_default(), "notify::dark", G_CALLBACK(+[](GObject *, GParamSpec *, gpointer self) {
      static_cast<GtkSystem *>(self)->scheme_.systemChanged(systemScheme());
    }), this);
  }

  DeviceFacts facts() override {
    struct utsname name {};
    uname(&name);
    const char *const *languages = g_get_language_names();
    std::string locale = languages && languages[0] ? languages[0] : "en";
    // "en_GB.UTF-8" to "en-GB".
    locale = locale.substr(0, locale.find_first_of(".@"));
    for (auto &c : locale) {
      c = c == '_' ? '-' : c;
    }
    if (locale == "C" || locale == "POSIX") {
      locale = "en";
    }
    return {.osVersion = name.release, .systemName = "Linux", .locale = locale, .rightToLeft = gtk_widget_get_default_direction() == GTK_TEXT_DIR_RTL};
  }
  void openUrl(const std::string &url, std::function<void(bool)> done) override {
    onMainContext([url, done = std::move(done)] { done(g_app_info_launch_default_for_uri(url.c_str(), nullptr, nullptr)); });
  }
  bool canOpenUrl(const std::string &url) override {
    gchar *scheme = g_uri_parse_scheme(url.c_str());
    if (!scheme) {
      return false;
    }
    GAppInfo *app = g_app_info_get_default_for_uri_scheme(scheme);
    g_free(scheme);
    if (app) {
      g_object_unref(app);
    }
    return app != nullptr;
  }
  void openSettings(std::function<void(bool)> done) override {
    done(false);
  }
  std::string colorScheme() override {
    return scheme_.current();
  }
  void setColorScheme(std::optional<std::string> scheme, std::function<void(std::string)> applied) override {
    scheme_.set(scheme);
    onMainContext([this, scheme, applied = std::move(applied)] {
      AdwColorScheme adw = !scheme ? ADW_COLOR_SCHEME_DEFAULT : *scheme == "dark" ? ADW_COLOR_SCHEME_FORCE_DARK : ADW_COLOR_SCHEME_FORCE_LIGHT;
      adw_style_manager_set_color_scheme(adw_style_manager_get_default(), adw);
      scheme_.systemChanged(systemScheme());
      applied(scheme_.applied(scheme));
    });
  }
  void showAlert(const AlertRequest &request, std::function<void(int, std::string, std::string)> done) override {
    fprintf(stderr, "[ngn] alert (no dialogs yet): %s: %s\n", request.title.c_str(), request.message.c_str());
    done(request.cancelIndex, "", "");
  }
  std::optional<std::string> clipboardText() override {
    std::lock_guard lock(mutex_);
    return clipboard_;
  }
  void setClipboardText(const std::string &text) override {
    std::lock_guard lock(mutex_);
    clipboard_ = text;
    ++changes_;
  }
  int64_t clipboardChangeCount() override {
    return changes_;
  }
  std::optional<folly::dynamic> preference(const std::string &key) override {
    return preferences_.get(key);
  }
  void setPreference(const std::string &key, std::optional<folly::dynamic> value) override {
    preferences_.set(key, value);
  }
  std::optional<std::pair<double, double>> imageSize(const std::string &bytes) override {
    GdkPixbufLoader *loader = gdk_pixbuf_loader_new();
    ImageSize size;
    g_signal_connect(loader, "size-prepared", G_CALLBACK(sizePrepared), &size);
    gdk_pixbuf_loader_write(loader, reinterpret_cast<const guchar *>(bytes.data()), bytes.size(), nullptr);
    gdk_pixbuf_loader_close(loader, nullptr);
    g_object_unref(loader);
    return size;
  }
  void announce(const Announcement &) override {}
  std::string appDataDirectory() override {
    g_mkdir_with_parents(appData_.c_str(), 0700);
    return appData_;
  }

 private:
  std::string appData_;
  JsonPreferences preferences_;
  ColorSchemeOverride scheme_;
  std::mutex mutex_;
  std::optional<std::string> clipboard_;
  std::atomic<int64_t> changes_{1};
};

class NoMenus final : public MenuBackend {
 public:
  void setMenuBar(std::vector<MenuItem>) override {}
};

class NoTray final : public TrayBackend {
 public:
  void setIcons(std::vector<TrayIcon>) override {}
};

class NoDock final : public DockBackend {
 public:
  void setMenu(std::optional<std::vector<MenuItem>>) override {}
  void bounce(int, bool) override {}
  void cancelBounce(int) override {}
};

// GLib's network monitor: whether a route exists, its interface types unknown (`other`).
class GioPathMonitor final : public PathMonitor {
 public:
  std::function<void()> watch(std::function<void(const NetworkPath &)> changed) override {
    auto *heap = new std::function<void(const NetworkPath &)>(std::move(changed));
    GNetworkMonitor *monitor = g_network_monitor_get_default();
    (*heap)(pathOf(g_network_monitor_get_network_available(monitor)));
    gulong handler = g_signal_connect_data(
        monitor, "network-changed", G_CALLBACK(networkChanged), heap,
        [](gpointer data, GClosure *) { delete static_cast<std::function<void(const NetworkPath &)> *>(data); }, GConnectFlags(0));
    return [monitor, handler] { g_signal_handler_disconnect(monitor, handler); };
  }

 private:
  static NetworkPath pathOf(bool available) {
    return {.satisfied = available, .other = available};
  }
  static void networkChanged(GNetworkMonitor *, gboolean available, gpointer data) {
    (*static_cast<std::function<void(const NetworkPath &)> *>(data))(pathOf(available));
  }
};

class FixedControls final : public ControlMeasurer {
 public:
  facebook::react::Size measure(ControlKind, const NativeControlProps &) const override {
    return {80, 24};
  }
};

} // namespace

std::shared_ptr<System> makeSystem(const std::string &appId, const std::string &appDataDirectory) {
  return std::make_shared<GtkSystem>(appId, appDataDirectory);
}

std::shared_ptr<StringStore> makeKeyFileStore(const std::string &path) {
  return std::make_shared<KeyFileStore>(path);
}

std::shared_ptr<MenuBackend> makeNoMenus() {
  return std::make_shared<NoMenus>();
}

std::shared_ptr<TrayBackend> makeNoTray() {
  return std::make_shared<NoTray>();
}

std::shared_ptr<DockBackend> makeNoDock() {
  return std::make_shared<NoDock>();
}

std::shared_ptr<PathMonitor> makePathMonitor() {
  return std::make_shared<GioPathMonitor>();
}

std::shared_ptr<ControlMeasurer> makeControlMeasurer() {
  return std::make_shared<FixedControls>();
}

} // namespace ngn::gtk
