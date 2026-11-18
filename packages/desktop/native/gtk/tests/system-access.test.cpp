// System access on GTK: the portal helper against a stand-in portal on a peer-to-peer connection
// (no session bus needed), Shell's and KeepAwake's portal calls, Processes' setup, the XDG user
// folders, and file watching through GFileMonitor.
#include "../file-system.h"
#include "../portal.h"
#include "../system-access.h"
#include "mounted-views.h"
#include "stand-in-portal.h"

#include "ngn/host-os.h"

#include <doctest/doctest.h>

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <optional>
#include <string>
#include <vector>

using ngn::testing::StandInPortal;

// A Mac's GLib names content types by UTI, with no shared-mime-info, and its file monitor is
// kqueue's, which reports no renames: what Shell's facts and watch read is Linux's.
#ifdef __APPLE__
constexpr bool kOnMac = true;
#else
constexpr bool kOnMac = false;
#endif

namespace {

std::string temporaryFolder() {
  char folder[] = "/tmp/ngn-system-access-XXXXXX";
  REQUIRE(mkdtemp(folder) != nullptr);
  char *real = realpath(folder, nullptr);
  std::string out = real;
  free(real);
  return out;
}

void write(const std::string &path, const std::string &text) {
  std::ofstream(path) << text;
}

ino_t inodeOf(const std::string &path) {
  struct stat info{};
  stat(path.c_str(), &info);
  return info.st_ino;
}

} // namespace

TEST_CASE("Shell opens a url through the OpenURI portal, and hears the user's answer") {
  StandInPortal portal;
  std::optional<bool> opened;
  ngn::gtk::makeShellOpener()->openUrl("https://example.com/a", [&opened](bool ok) { opened = ok; });
  ngn::testing::runUntil([&opened] { return opened.has_value(); });
  CHECK(*opened);
  REQUIRE(portal.calls.size() == 1);
  CHECK(portal.calls[0].method == "OpenURI");
  CHECK(portal.calls[0].second == "https://example.com/a");

  // Cancelled in the portal's app chooser.
  portal.response = 1;
  opened.reset();
  ngn::gtk::openUri("https://example.com/b", [&opened](bool ok) { opened = ok; });
  ngn::testing::runUntil([&opened] { return opened.has_value(); });
  CHECK_FALSE(*opened);
  CHECK(portal.calls.back().second == "https://example.com/b");
}

TEST_CASE("A portal request answers Absent where the portal has no such interface") {
  StandInPortal portal;
  portal.offersOpenUri = false;
  std::optional<ngn::gtk::portal::Outcome> outcome;
  ngn::gtk::portal::request("org.freedesktop.portal.OpenURI", "OpenURI", g_variant_new("(ss)", "", "https://example.com"),
                            g_variant_builder_new(G_VARIANT_TYPE_VARDICT), nullptr,
                            [&outcome](ngn::gtk::portal::Outcome answer, GVariant *) { outcome = answer; });
  ngn::testing::runUntil([&outcome] { return outcome.has_value(); });
  CHECK(*outcome == ngn::gtk::portal::Outcome::Absent);
}

TEST_CASE("Shell opens a path, and shows one in its folder, by passing the portal the file") {
  StandInPortal portal;
  auto folder = temporaryFolder();
  auto file = folder + "/notes.txt";
  write(file, "hello");
  auto shell = ngn::gtk::makeShellOpener();
  std::optional<bool> opened;
  shell->openPath(file, [&opened](bool ok) { opened = ok; });
  ngn::testing::runUntil([&opened] { return opened.has_value(); });
  CHECK(*opened);
  REQUIRE(portal.calls.size() == 1);
  CHECK(portal.calls[0].method == "OpenFile");
  CHECK(portal.calls[0].inode == inodeOf(file));

  opened.reset();
  shell->showItemInFolder(file, [&opened](bool ok) { opened = ok; });
  ngn::testing::runUntil([&opened] { return opened.has_value(); });
  CHECK(*opened);
  REQUIRE(portal.calls.size() == 2);
  CHECK(portal.calls[1].method == "OpenDirectory");
  CHECK(portal.calls[1].inode == inodeOf(file));

  // Nothing there: refused without asking the portal.
  opened.reset();
  shell->openPath(folder + "/missing.txt", [&opened](bool ok) { opened = ok; });
  ngn::testing::runUntil([&opened] { return opened.has_value(); });
  CHECK_FALSE(*opened);
  CHECK(portal.calls.size() == 2);
  std::filesystem::remove_all(folder);
}

TEST_CASE("Shell's facts say a script, a desktop entry or a program runs code, and a text file does not" * doctest::skip(kOnMac)) {
  REQUIRE(ngn::testing::gtkReady());
  auto folder = temporaryFolder();
  auto shell = ngn::gtk::makeShellOpener();
  write(folder + "/notes.txt", "plain words\n");
  write(folder + "/run", "#!/bin/sh\necho hi\n");
  write(folder + "/app.desktop", "[Desktop Entry]\nType=Application\nName=App\nExec=app\n");
  chmod((folder + "/run").c_str(), 0755);

  auto text = shell->facts(folder + "/notes.txt");
  CHECK(text.exists);
  CHECK_FALSE(text.executable);
  CHECK_FALSE(text.runsCode);
  auto script = shell->facts(folder + "/run");
  CHECK(script.executable);
  CHECK(script.runsCode);
  CHECK(shell->facts(folder + "/app.desktop").runsCode);
  CHECK_FALSE(shell->facts(folder + "/missing").exists);
  // A folder opens in the file manager.
  CHECK_FALSE(shell->facts(folder).runsCode);
  std::filesystem::remove_all(folder);
}

TEST_CASE("KeepAwake holds the session idle through the Inhibit portal, and closes the request to let it go") {
  StandInPortal portal;
  auto application = gtk_application_new("ngn.keep-awake.test", G_APPLICATION_NON_UNIQUE);
  auto sleep = ngn::gtk::makeSleepPreventer(application);
  sleep->hold(true);
  ngn::testing::runUntil([&portal] { return portal.calls.size() == 1; });
  CHECK(portal.calls[0].method == "Inhibit");
  // Idle.
  CHECK(portal.calls[0].flags == 8);
  // Held twice is still one hold.
  sleep->hold(true);
  sleep->hold(false);
  ngn::testing::runUntil([&portal] { return portal.calls.size() == 2; });
  CHECK(portal.calls[1].method == "Close");
  CHECK(portal.calls[1].path.rfind("/org/freedesktop/portal/desktop/request/test/", 0) == 0);

  // Let go before the portal returned its request: that request is closed as it arrives.
  sleep->hold(true);
  sleep->hold(false);
  ngn::testing::runUntil([&portal] { return portal.calls.size() == 4; });
  CHECK(portal.calls[2].method == "Inhibit");
  CHECK(portal.calls[3].method == "Close");
  // A closed hold never answers, and is not kept waiting for an answer.
  ngn::testing::runUntil([] { return ngn::gtk::portal::requestsInFlight() == 0; });
  sleep.reset();
  g_object_unref(application);
}

TEST_CASE("Processes searches the app's /app/bin first inside a Flatpak, and reads no capabilities from bad JSON") {
  auto os = ngn::linuxOs();
  auto outside = ngn::gtk::processesSetup(os, "", false);
  CHECK(outside.lookup.searchPath == os.searchPath);
  auto inside = ngn::gtk::processesSetup(os, "", true);
  REQUIRE(inside.lookup.searchPath.size() == os.searchPath.size() + 1);
  CHECK(inside.lookup.searchPath.front() == "/app/bin");
  CHECK_FALSE(inside.sandboxed);
  CHECK_NOTHROW(ngn::gtk::processesSetup(os, "{not json", false));
  CHECK(outside.environment.contains("PATH") == (getenv("PATH") != nullptr));
}

TEST_CASE("The desktop and downloads folders come from the XDG user-dirs file, absent when it names none") {
  std::string file = "# written by xdg-user-dirs-update\n"
                     "XDG_DESKTOP_DIR=\"$HOME/Schreibtisch\"\n"
                     "XDG_DOWNLOAD_DIR=\"/data/downloads/\"\n"
                     "XDG_MUSIC_DIR=\"$HOME/\"\n";
  CHECK(ngn::gtk::xdgUserDir(file, "DESKTOP", "/home/me") == "/home/me/Schreibtisch");
  CHECK(ngn::gtk::xdgUserDir(file, "DOWNLOAD", "/home/me") == "/data/downloads");
  // Set to the home folder itself: the user has none.
  CHECK(ngn::gtk::xdgUserDir(file, "MUSIC", "/home/me") == "");
  // Not in the file, or no file: none, never a guessed ~/Desktop.
  CHECK(ngn::gtk::xdgUserDir(file, "PICTURES", "/home/me") == "");
  CHECK(ngn::gtk::xdgUserDir("", "DESKTOP", "/home/me") == "");
  // A relative path is not allowed, and a later line wins.
  CHECK(ngn::gtk::xdgUserDir("XDG_DESKTOP_DIR=\"Desktop\"\n", "DESKTOP", "/home/me") == "");
  CHECK(ngn::gtk::xdgUserDir("XDG_DESKTOP_DIR=\"$HOME/A\"\nXDG_DESKTOP_DIR=\"$HOME/B\"\n", "DESKTOP", "/home/me") == "/home/me/B");
}

TEST_CASE("The app's folders read the user-dirs file under XDG_CONFIG_HOME") {
  auto folder = temporaryFolder();
  auto config = folder + "/config";
  std::filesystem::create_directories(config);
  write(config + "/user-dirs.dirs", "XDG_DOWNLOAD_DIR=\"" + folder + "/dl\"\n");
  std::filesystem::create_directories(folder + "/dl");
  const char *before = getenv("XDG_CONFIG_HOME");
  std::optional<std::string> saved = before ? std::optional<std::string>(before) : std::nullopt;
  setenv("XDG_CONFIG_HOME", config.c_str(), 1);
  // GLib reads XDG_CONFIG_HOME once; this test's process may have read it already.
  g_reload_user_special_dirs_cache();
  try {
    auto folders = ngn::gtk::fileFolders(folder + "/data", folder + "/cache", folder);
    if (std::string(g_get_user_config_dir()) == config) {
      CHECK(folders.downloads == folder + "/dl");
      CHECK(folders.desktop == "");
    }
    CHECK(folders.document == folder + "/data/Documents");
    CHECK(std::filesystem::is_directory(folders.document));
  } catch (...) {
    saved ? setenv("XDG_CONFIG_HOME", saved->c_str(), 1) : unsetenv("XDG_CONFIG_HOME");
    throw;
  }
  saved ? setenv("XDG_CONFIG_HOME", saved->c_str(), 1) : unsetenv("XDG_CONFIG_HOME");
  std::filesystem::remove_all(folder);
}

TEST_CASE("FileSystem's watch hears a file created, changed, renamed and removed in a folder, and nothing once stopped" * doctest::skip(kOnMac)) {
  REQUIRE(ngn::testing::gtkReady());
  auto folder = temporaryFolder();
  auto watcher = ngn::gtk::makeFileWatcher();
  std::vector<ngn::FileWatcher::Event> heard;
  int handle = watcher->start(folder, [&heard](std::vector<ngn::FileWatcher::Event> batch) {
    heard.insert(heard.end(), batch.begin(), batch.end());
  });
  CHECK(handle != 0);
  // The monitor is made on the main context.
  for (int i = 0; i < 5; ++i) {
    g_main_context_iteration(nullptr, FALSE);
  }
  auto has = [&heard](const std::string &path, auto flag) {
    return std::any_of(heard.begin(), heard.end(), [&](const ngn::FileWatcher::Event &e) { return e.path == path && flag(e); });
  };
  write(folder + "/a.txt", "one");
  ngn::testing::runUntil([&] { return has(folder + "/a.txt", [](auto &e) { return e.created; }); });
  write(folder + "/a.txt", "two");
  ngn::testing::runUntil([&] { return has(folder + "/a.txt", [](auto &e) { return e.modified; }); });
  std::filesystem::rename(folder + "/a.txt", folder + "/b.txt");
  ngn::testing::runUntil([&] { return has(folder + "/b.txt", [](auto &e) { return e.renamed; }); });
  // The old path, then the new one, as the core reads a rename.
  auto old = std::find_if(heard.begin(), heard.end(), [&](auto &e) { return e.renamed && e.path == folder + "/a.txt"; });
  auto now = std::find_if(heard.begin(), heard.end(), [&](auto &e) { return e.renamed && e.path == folder + "/b.txt"; });
  REQUIRE(old != heard.end());
  CHECK(old + 1 == now);
  std::filesystem::remove(folder + "/b.txt");
  ngn::testing::runUntil([&] { return has(folder + "/b.txt", [](auto &e) { return e.removed; }); });

  watcher->stop(handle);
  heard.clear();
  write(folder + "/c.txt", "after");
  gint64 until = g_get_monotonic_time() + G_USEC_PER_SEC / 2;
  while (g_get_monotonic_time() < until) {
    g_main_context_iteration(nullptr, FALSE);
  }
  CHECK(heard.empty());
  std::filesystem::remove_all(folder);
}
