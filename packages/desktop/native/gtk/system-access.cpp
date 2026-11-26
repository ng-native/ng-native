#include "system-access.h"

#include "app-windows.h"
#include "portal.h"

#include <folly/json.h>
#include <gio/gunixfdlist.h>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <memory>

extern char **environ;

namespace ngn::gtk {

namespace {

constexpr const char *kOpenUri = "org.freedesktop.portal.OpenURI";

using Done = std::function<void(bool)>;

// The portal's answer as Done's: opened, or not; `fallBack` when no portal is there to ask.
portal::Answer answered(Done done, std::function<void(Done)> fallBack) {
  return [done = std::move(done), fallBack = std::move(fallBack)](portal::Outcome outcome, GVariant *) mutable {
    if (outcome == portal::Outcome::Absent) {
      fallBack(std::move(done));
    } else {
      done(outcome == portal::Outcome::Done);
    }
  };
}

// Calls OpenURI's `method` for the front window, with `argument` (the uri, or the fd's index in
// `fds`) after the window's handle.
void openThroughPortal(const char *method, GVariant *argument, GUnixFDList *fds, portal::Answer answer) {
  g_variant_ref_sink(argument);
  portal::parentHandle(portal::frontWindow(), [method, argument, fds, answer = std::move(answer)](const std::string &parent,
                                                                                                  std::function<void()> drop) mutable {
    GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
    portal::request(kOpenUri, method, g_variant_new("(s@*)", parent.c_str(), argument), options, fds,
                    [answer = std::move(answer), drop = std::move(drop)](portal::Outcome outcome, GVariant *results) {
                      drop();
                      answer(outcome, results);
                    });
    g_variant_unref(argument);
    g_clear_object(&fds);
  });
}

// An fd for `path` that the portal reads the file through, in a list of its own; null when it
// cannot be opened.
GUnixFDList *fdFor(const std::string &path) {
#ifdef O_PATH
  int fd = open(path.c_str(), O_PATH | O_CLOEXEC);
#else
  int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
#endif
  if (fd < 0) {
    return nullptr;
  }
  GUnixFDList *fds = g_unix_fd_list_new_from_array(&fd, 1);
  return fds;
}

void launchUriWithGtk(const std::string &uri, Done done) {
  GtkUriLauncher *launcher = gtk_uri_launcher_new(uri.c_str());
  gtk_uri_launcher_launch(launcher, portal::frontWindow(), nullptr, +[](GObject *source, GAsyncResult *result, gpointer data) {
    std::unique_ptr<Done> done(static_cast<Done *>(data));
    GError *error = nullptr;
    bool launched = gtk_uri_launcher_launch_finish(GTK_URI_LAUNCHER(source), result, &error);
    if (error) {
      fprintf(stderr, "[ngn] could not open a url: %s\n", error->message);
      g_error_free(error);
    }
    (*done)(launched);
  }, new Done(std::move(done)));
  g_object_unref(launcher);
}

void reportLaunch(void *data, bool launched, GError *error) {
  std::unique_ptr<Done> done(static_cast<Done *>(data));
  if (error) {
    fprintf(stderr, "[ngn] could not open a file: %s\n", error->message);
    g_error_free(error);
  }
  (*done)(launched);
}

void launchFileWithGtk(const std::string &path, bool containingFolder, Done done) {
  GFile *file = g_file_new_for_path(path.c_str());
  GtkFileLauncher *launcher = gtk_file_launcher_new(file);
  g_object_unref(file);
  if (containingFolder) {
    gtk_file_launcher_open_containing_folder(launcher, portal::frontWindow(), nullptr, +[](GObject *source, GAsyncResult *result, gpointer data) {
      GError *error = nullptr;
      bool launched = gtk_file_launcher_open_containing_folder_finish(GTK_FILE_LAUNCHER(source), result, &error);
      reportLaunch(data, launched, error);
    }, new Done(std::move(done)));
  } else {
    gtk_file_launcher_launch(launcher, portal::frontWindow(), nullptr, +[](GObject *source, GAsyncResult *result, gpointer data) {
      GError *error = nullptr;
      bool launched = gtk_file_launcher_launch_finish(GTK_FILE_LAUNCHER(source), result, &error);
      reportLaunch(data, launched, error);
    }, new Done(std::move(done)));
  }
  g_object_unref(launcher);
}

bool exists(const std::string &path) {
  struct stat info{};
  return stat(path.c_str(), &info) == 0;
}

// The content types whose opening runs code: programs, libraries and scripts, desktop entries and
// AppImages, which launch what they name, and package and Flatpak installers. Not GLib's
// can_be_executable, which says yes for any text file.
const char *const kRunsCode[] = {
    "application/x-executable", "application/x-pie-executable", "application/x-sharedlib", "application/x-shellscript",
    "application/x-csh", "application/x-perl", "application/x-ruby", "text/x-python", "text/x-python3",
    "application/x-desktop", "application/vnd.appimage", "application/x-iso9660-appimage", "application/vnd.flatpak",
    "application/vnd.flatpak.ref", "application/vnd.flatpak.repo", "application/x-rpm",
    "application/vnd.debian.binary-package", "application/x-ms-dos-executable", "application/x-msdownload",
    "application/x-msi"};

bool runsCode(const std::string &path) {
  // From the file's name and its first bytes: a script with no extension, an ELF named .txt.
  GFile *file = g_file_new_for_path(path.c_str());
  GFileInfo *info = g_file_query_info(file, G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE, G_FILE_QUERY_INFO_NONE, nullptr, nullptr);
  g_object_unref(file);
  gchar *type = info && g_file_info_get_content_type(info) ? g_strdup(g_file_info_get_content_type(info))
                                                           : g_content_type_guess(path.c_str(), nullptr, 0, nullptr);
  g_clear_object(&info);
  bool runs = false;
  for (const char *code : kRunsCode) {
    runs = runs || g_content_type_is_a(type, code);
  }
  g_free(type);
  return runs;
}

class PortalOpener final : public ShellOpener {
 public:
  PathFacts facts(const std::string &path) override {
    PathFacts facts;
    struct stat info{};
    facts.exists = stat(path.c_str(), &info) == 0;
    if (!facts.exists) {
      return facts;
    }
    facts.executable = S_ISREG(info.st_mode) && access(path.c_str(), X_OK) == 0;
    facts.runsCode = !S_ISDIR(info.st_mode) && runsCode(path);
    return facts;
  }

  void openUrl(const std::string &url, Done done) override {
    openUri(url, std::move(done));
  }

  void openPath(const std::string &path, Done done) override {
    openFile("OpenFile", path, false, std::move(done));
  }

  void showItemInFolder(const std::string &path, Done done) override {
    openFile("OpenDirectory", path, true, std::move(done));
  }

 private:
  static void openFile(const char *method, std::string path, bool containingFolder, Done done) {
    onMainContext([method, path = std::move(path), containingFolder, done = std::move(done)]() mutable {
      GUnixFDList *fds = exists(path) ? fdFor(path) : nullptr;
      if (!fds) {
        done(false);
        return;
      }
      openThroughPortal(method, g_variant_new_handle(0), fds, answered(std::move(done), [path, containingFolder](Done done) {
        launchFileWithGtk(path, containingFolder, std::move(done));
      }));
    });
  }
};

class Inhibitor final : public SleepPreventer, public std::enable_shared_from_this<Inhibitor> {
 public:
  explicit Inhibitor(GtkApplication *application) : application_(G_APPLICATION(g_object_ref(application))) {}
  ~Inhibitor() override {
    g_object_unref(application_);
  }

  void hold(bool awake) override {
    onMainContext([self = shared_from_this(), awake] { self->set(awake); });
  }

 private:
  // On the main context. A request still being made is ended once it is open; only the latest
  // hold counts.
  void set(bool awake) {
    if (awake == awake_) {
      return;
    }
    awake_ = awake;
    if (!awake) {
      release();
      return;
    }
    auto generation = ++generation_;
    auto self = shared_from_this();
    GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(options, "{sv}", "reason", g_variant_new_string("Kept awake by the app"));
    // Idle is Inhibit's 8. No window: the hold is the app's, not one window's.
    portal::request("org.freedesktop.portal.Inhibit", "Inhibit", g_variant_new("(su)", "", 8u), options, nullptr,
                    [self, generation](portal::Outcome outcome, GVariant *) {
                      if (outcome == portal::Outcome::Absent && self->awake_ && self->generation_ == generation) {
                        self->cookie_ = gtk_application_inhibit(GTK_APPLICATION(self->application_), nullptr,
                                                                GTK_APPLICATION_INHIBIT_IDLE, "Kept awake by the app");
                      }
                    },
                    true, [self, generation](const std::string &path) {
                      if (self->awake_ && self->generation_ == generation) {
                        self->request_ = path;
                      } else {
                        portal::close(path);
                      }
                    });
  }

  void release() {
    ++generation_;
    if (!request_.empty()) {
      portal::close(request_);
      request_.clear();
    }
    if (cookie_ != 0) {
      gtk_application_uninhibit(GTK_APPLICATION(application_), cookie_);
      cookie_ = 0;
    }
  }

  GApplication *application_;
  bool awake_{false};
  unsigned generation_{0};
  std::string request_;
  guint cookie_{0};
};

} // namespace

bool insideFlatpak() {
  return g_file_test("/.flatpak-info", G_FILE_TEST_EXISTS);
}

ProcessesSetup processesSetup(const HostOs &os, const std::string &capabilitiesJson, bool flatpak) {
  ProcessesSetup setup;
  for (char **e = environ; e && *e; ++e) {
    std::string entry = *e;
    if (auto eq = entry.find('='); eq != std::string::npos) {
      setup.environment[entry.substr(0, eq)] = entry.substr(eq + 1);
    }
  }
  setup.lookup = {
      .isExecutable = [](const std::string &path) { return access(path.c_str(), X_OK) == 0; },
      .searchPath = os.searchPath,
      .home = accountHome(),
  };
  if (flatpak) {
    setup.lookup.searchPath.insert(setup.lookup.searchPath.begin(), "/app/bin");
  }
  if (!capabilitiesJson.empty()) {
    try {
      setup.capabilities = parseCapabilities(folly::parseJson(capabilitiesJson));
    } catch (const std::exception &error) {
      fprintf(stderr, "[ngn] --capabilities is not JSON (%s): no capabilities\n", error.what());
    }
  }
  return setup;
}

void openUri(const std::string &uri, Done done) {
  onMainContext([uri, done = std::move(done)]() mutable {
    openThroughPortal("OpenURI", g_variant_new_string(uri.c_str()), nullptr,
                      answered(std::move(done), [uri](Done done) { launchUriWithGtk(uri, std::move(done)); }));
  });
}

std::shared_ptr<ShellOpener> makeShellOpener() {
  return std::make_shared<PortalOpener>();
}

std::shared_ptr<SleepPreventer> makeSleepPreventer(GtkApplication *application) {
  return std::make_shared<Inhibitor>(application);
}

} // namespace ngn::gtk
