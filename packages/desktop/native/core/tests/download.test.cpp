#include "fake-network.h"
#include "ngn/download.h"

#include <doctest/doctest.h>

#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <sstream>

namespace fs = std::filesystem;

namespace {

struct Folder {
  fs::path path = fs::temp_directory_path() / ("ngn-download-" + std::to_string(getpid()) + "-" + std::to_string(rand()));
  Folder() {
    fs::create_directories(path);
  }
  ~Folder() {
    std::error_code ignored;
    fs::permissions(path, fs::perms::owner_all, fs::perm_options::add, ignored);
    fs::remove_all(path, ignored);
  }
};

std::string contents(const fs::path &path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream out;
  out << in.rdbuf();
  return out.str();
}

void write(const fs::path &path, const std::string &text) {
  std::ofstream(path, std::ios::binary) << text;
}

// Downloads `body` to `target` through a fake client, and answers why it failed, or "".
std::string download(const std::string &target, const std::string &body) {
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  std::optional<std::string> said;
  ngn::downloadFile(http, "https://example.com/font.ttf", target, [&](const std::string &error) { said = error; });
  REQUIRE(http->sent.size() == 1);
  auto &callbacks = http->sent[0]->callbacks;
  callbacks.onResponse({.status = 200});
  callbacks.onData(body, -1);
  callbacks.onComplete("", false);
  REQUIRE(said);
  return *said;
}

} // namespace

TEST_CASE("a download replaces the file at its target only once the whole body is saved") {
  Folder folder;
  auto target = folder.path / "font.ttf";
  CHECK(download(target.string(), "new") == "");
  CHECK(contents(target) == "new");

  // A read-only file in a folder the host can write: replaced, never deleted.
  write(target, "old");
  fs::permissions(target, fs::perms::owner_read);
  CHECK(download(target.string(), "newer") == "");
  CHECK(contents(target) == "newer");

  // A save that fails leaves the file that was there.
  fs::permissions(folder.path, fs::perms::owner_read | fs::perms::owner_exec);
  CHECK(download(target.string(), "lost") == "could not be saved to " + target.string());
  CHECK(contents(target) == "newer");
  fs::permissions(folder.path, fs::perms::owner_all);
  // And nothing half-written beside it.
  CHECK(std::distance(fs::directory_iterator(folder.path), fs::directory_iterator()) == 1);
}
