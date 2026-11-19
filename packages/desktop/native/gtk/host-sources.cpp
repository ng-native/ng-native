#include "host-sources.h"

#include "alerts.h"
#include "app-info.h"
#include "app-windows.h"
#include "locales.h"
#include "native-controls.h"
#include "system-access.h"

#include "ngn/posix-locale.h"

#include <adwaita.h>
#if __has_include(<gio/gdesktopappinfo.h>)
#include <gio/gdesktopappinfo.h>
#define NGN_DESKTOP_APP_INFO 1
#endif
#include <gtk/gtk.h>

#include <atomic>
#include <memory>
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

// Inside a Flatpak or a Snap, where the desktop portal opens a uri and no handler is visible.
bool sandboxed() {
  return g_file_test("/.flatpak-info", G_FILE_TEST_EXISTS) || g_getenv("SNAP") != nullptr;
}

// The desktop's own settings app, GNOME's or KDE Plasma's. None in the dev loop on a Mac, whose
// GLib has no desktop files.
bool launchSettingsApp() {
#ifndef NGN_DESKTOP_APP_INFO
  return false;
#else
  for (const char *id : {"org.gnome.Settings.desktop", "gnome-control-center.desktop", "systemsettings.desktop", "org.kde.systemsettings.desktop"}) {
    if (GDesktopAppInfo *app = g_desktop_app_info_new(id)) {
      bool launched = g_app_info_launch(G_APP_INFO(app), nullptr, nullptr, nullptr);
      g_object_unref(app);
      if (launched) {
        return true;
      }
    }
  }
  return false;
#endif
}

std::string systemScheme() {
  return adw_style_manager_get_dark(adw_style_manager_get_default()) ? "dark" : "light";
}

class GtkSystem final : public System {
 public:
  GtkSystem(const std::string &appId, std::string appData, std::function<void(int64_t)> clipboardChanged)
      : appData_(std::move(appData)),
        preferences_(makeKeyFileStore(appData_ + "/preferences.ini"), appId, false),
        scheme_(systemScheme()),
        clipboardChanged_(std::move(clipboardChanged)) {
    g_signal_connect(adw_style_manager_get_default(), "notify::dark", G_CALLBACK(+[](GObject *, GParamSpec *, gpointer self) {
      static_cast<GtkSystem *>(self)->scheme_.systemChanged(systemScheme());
    }), this);
    if (GdkDisplay *display = gdk_display_get_default()) {
      clipboard_ = GDK_CLIPBOARD(g_object_ref(gdk_display_get_clipboard(display)));
      g_signal_connect(clipboard_, "changed", G_CALLBACK(+[](GdkClipboard *, gpointer self) {
        static_cast<GtkSystem *>(self)->readClipboard(true);
      }), this);
      readClipboard(false);
    }
  }
  ~GtkSystem() override {
    g_signal_handlers_disconnect_by_data(adw_style_manager_get_default(), this);
    if (clipboard_) {
      g_signal_handlers_disconnect_by_data(clipboard_, this);
      g_object_unref(clipboard_);
    }
    *alive_ = false;
  }

  DeviceFacts facts() override {
    // The distribution's name and version, not the kernel's: Platform.Version is "24.04" on
    // Ubuntu 24.04, as OS_VERSION reads it.
    auto release = distroRelease();
    // The most preferred language, as Localization's first locale.
    auto languages = preferredLanguageTags(getenv("LANGUAGE") ? getenv("LANGUAGE") : "", localeOf("LC_MESSAGES"));
    std::string locale = languages.empty() ? "en" : languages.front();
    return {.osVersion = release.versionId,
            .systemName = release.name,
            .interfaceIdiom = "desktop",
            .locale = locale,
            .rightToLeft = gtk_widget_get_default_direction() == GTK_TEXT_DIR_RTL};
  }
  void openUrl(const std::string &url, std::function<void(bool)> done) override {
    openUri(url, std::move(done));
  }
  bool canOpenUrl(const std::string &url) override {
    return canOpenUri(url, sandboxed(), [](const std::string &scheme) {
      GAppInfo *app = g_app_info_get_default_for_uri_scheme(scheme.c_str());
      if (app) {
        g_object_unref(app);
      }
      return app != nullptr;
    });
  }
  void openSettings(std::function<void(bool)> done) override {
    // A Linux app has no page of its own in the desktop's settings: this opens them, as macOS opens
    // System Settings.
    onMainContext([done = std::move(done)] { done(launchSettingsApp()); });
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
    onMainContext([request, done = std::move(done)]() mutable { ngn::gtk::showAlert(request, std::move(done), activeWindow()); });
  }
  // What the clipboard held as it last changed: GDK reads it asynchronously, which System's
  // callers do not, so another app's change counts once its text has been read.
  std::optional<std::string> clipboardText() override {
    std::lock_guard lock(mutex_);
    return text_;
  }
  void setClipboardText(const std::string &text) override {
    {
      std::lock_guard lock(mutex_);
      text_ = text;
      ++changes_;
    }
    onMainContext([this, alive = alive_, text] {
      if (*alive && clipboard_) {
        gdk_clipboard_set_text(clipboard_, text.c_str());
      }
    });
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
  // Another app's text, read as the clipboard changes (`announce`), or at launch. Text the app set
  // itself is already kept and counted. Only the latest read counts: one change can come as more
  // than one signal, and reads can finish out of order.
  void readClipboard(bool announce) {
    if (gdk_clipboard_is_local(clipboard_)) {
      return;
    }
    struct Read {
      GtkSystem *self;
      std::shared_ptr<bool> alive;
      bool announce;
      uint64_t number;
    };
    gdk_clipboard_read_text_async(clipboard_, nullptr, +[](GObject *source, GAsyncResult *result, gpointer data) {
      std::unique_ptr<Read> read(static_cast<Read *>(data));
      GError *error = nullptr;
      gchar *text = gdk_clipboard_read_text_finish(GDK_CLIPBOARD(source), result, &error);
      g_clear_error(&error);
      if (!*read->alive || read->number != read->self->reads_) {
        g_free(text);
        return;
      }
      int64_t count = 0;
      {
        std::lock_guard lock(read->self->mutex_);
        read->self->text_ = text ? std::optional<std::string>(text) : std::nullopt;
        count = read->announce ? ++read->self->changes_ : read->self->changes_.load();
      }
      g_free(text);
      if (read->announce && read->self->clipboardChanged_) {
        read->self->clipboardChanged_(count);
      }
    }, new Read{this, alive_, announce, ++reads_});
  }

  std::string appData_;
  JsonPreferences preferences_;
  ColorSchemeOverride scheme_;
  std::function<void(int64_t)> clipboardChanged_;
  GdkClipboard *clipboard_{nullptr};
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
  // Reads started, on the main context.
  uint64_t reads_{0};
  std::mutex mutex_;
  std::optional<std::string> text_;
  std::atomic<int64_t> changes_{1};
};

class NoMenus final : public MenuBackend {
 public:
  void setMenuBar(std::vector<MenuItem>) override {}
};

class GtkUndo final : public UndoManager {
 public:
  void registerAction(const std::string &label, std::function<void()> action) override {
    // Inline on the UI thread: an undo registers its redo while it runs.
    onMainContext([stacks = stacks_, label, action = std::move(action)]() mutable {
      stacks->registerAction(label, std::move(action));
    });
  }
  bool undoing() const override {
    return stacks_->undoing();
  }
  void undo() override {
    onMainContext([stacks = stacks_] { stacks->undo(); });
  }
  void redo() override {
    onMainContext([stacks = stacks_] { stacks->redo(); });
  }
  void clear() override {
    onMainContext([stacks = stacks_] { stacks->clear(); });
  }

 private:
  std::shared_ptr<UndoStacks> stacks_ = std::make_shared<UndoStacks>();
};

} // namespace

bool canOpenUri(const std::string &uri, bool sandboxed, const std::function<bool(const std::string &scheme)> &hasHandler) {
  gchar *scheme = g_uri_parse_scheme(uri.c_str());
  if (!scheme) {
    return false;
  }
  std::string name = scheme;
  g_free(scheme);
  return sandboxed || hasHandler(name);
}

std::shared_ptr<System> makeSystem(const std::string &appId, const std::string &appDataDirectory, std::function<void(int64_t)> clipboardChanged) {
  return std::make_shared<GtkSystem>(appId, appDataDirectory, std::move(clipboardChanged));
}

std::shared_ptr<StringStore> makeKeyFileStore(const std::string &path) {
  return std::make_shared<KeyFileStore>(path);
}

std::shared_ptr<MenuBackend> makeNoMenus() {
  return std::make_shared<NoMenus>();
}

std::shared_ptr<UndoManager> makeUndoManager() {
  return std::make_shared<GtkUndo>();
}

std::shared_ptr<ControlMeasurer> makeControlMeasurer() {
  return std::make_shared<GtkControlMeasurer>();
}

} // namespace ngn::gtk
