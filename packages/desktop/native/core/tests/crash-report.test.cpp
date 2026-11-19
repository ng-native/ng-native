#include "ngn/crash-report.h"

#include <doctest/doctest.h>

#include <sys/resource.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>

namespace {

[[maybe_unused]] std::string slurp(const std::filesystem::path &file) {
  std::ifstream in(file);
  std::stringstream text;
  text << in.rdbuf();
  return text.str();
}

// In a forked child about to die of a signal: no core file, which would land in the working
// directory (the package's, under the build script).
[[maybe_unused]] void noCoreFile() {
  struct rlimit none{0, 0};
  setrlimit(RLIMIT_CORE, &none);
}

} // namespace

TEST_CASE("a crash report goes in a test launch's state folder, else under XDG_STATE_HOME for the app") {
  std::map<std::string, std::string> vars{{"HOME", "/home/ada"}};
  auto env = [&vars](const std::string &name) -> std::optional<std::string> {
    auto it = vars.find(name);
    return it == vars.end() ? std::nullopt : std::optional<std::string>(it->second);
  };
  CHECK(ngn::crashReportPath("dev.notes", std::string("/tmp/run-1"), env) == "/tmp/run-1/crash.txt");
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env) == "/home/ada/.local/state/dev.notes/crash.txt");
  vars["XDG_STATE_HOME"] = "/var/state";
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env) == "/var/state/dev.notes/crash.txt");
  // An empty XDG_STATE_HOME is unset, as the XDG spec has it.
  vars["XDG_STATE_HOME"] = "";
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env) == "/home/ada/.local/state/dev.notes/crash.txt");
}

TEST_CASE("a crash report goes under the account's home folder for a process started without HOME") {
  std::map<std::string, std::string> vars;
  auto env = [&vars](const std::string &name) -> std::optional<std::string> {
    auto it = vars.find(name);
    return it == vars.end() ? std::nullopt : std::optional<std::string>(it->second);
  };
  auto account = []() -> std::optional<std::string> { return "/home/ada"; };
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env, account) == "/home/ada/.local/state/dev.notes/crash.txt");
  // An empty HOME is unset too.
  vars["HOME"] = "";
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env, account) == "/home/ada/.local/state/dev.notes/crash.txt");
  // With no account either, the temporary folder, never the root's.
  std::string temporary = std::filesystem::temp_directory_path().string();
  auto none = []() -> std::optional<std::string> { return std::nullopt; };
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env, none) == temporary + "/.local/state/dev.notes/crash.txt");
  // By default, the password database's (a container's user can have no entry).
  auto home = ngn::accountHomeDirectory();
  CHECK(ngn::crashReportPath("dev.notes", std::nullopt, env) == home.value_or(temporary) + "/.local/state/dev.notes/crash.txt");
}

// Linux only, the one host that installs it: on macOS each crash would go to the system's crash
// reporter as well.
#ifdef __linux__
TEST_CASE("a fatal signal writes the crash report, names the signal and the stack, and still kills the process") {
  auto dir = std::filesystem::temp_directory_path() / ("ngn-crash-" + std::to_string(getpid()));
  struct Remove {
    std::filesystem::path dir;
    ~Remove() {
      std::error_code ignored;
      std::filesystem::remove_all(dir, ignored);
    }
  } remove{dir};
  auto path = dir / "nested" / "crash.txt";
  for (int signal : {SIGSEGV, SIGABRT}) {
    CAPTURE(signal);
    pid_t child = fork();
    REQUIRE(child >= 0);
    if (child == 0) {
      noCoreFile();
      ngn::installCrashReport(path.string(), "ngn-test-host");
      raise(signal);
      _exit(0);
    }
    int status = 0;
    REQUIRE(waitpid(child, &status, 0) == child);
    // It died of the signal, as it would have with no handler.
    REQUIRE(WIFSIGNALED(status));
    CHECK(WTERMSIG(status) == signal);
    std::string text = slurp(path);
    CHECK(text.find("ngn-test-host crashed: ") == 0);
    CHECK(text.find(signal == SIGSEGV ? "SIGSEGV (signal " : "SIGABRT (signal ") != std::string::npos);
    CHECK(text.find("(signal " + std::to_string(signal) + ")") != std::string::npos);
    CHECK(text.find("Native stack:\n") != std::string::npos);
    // At least one frame below the heading.
    CHECK(text.size() > text.find("Native stack:\n") + 20);
  }
}

namespace {

struct sigaction gChained;
int gCalls = 0;

} // namespace

TEST_CASE("a fatal signal still kills the process when a handler installed later calls the report's and returns") {
  pid_t child = fork();
  REQUIRE(child >= 0);
  if (child == 0) {
    noCoreFile();
    auto dir = std::filesystem::temp_directory_path() / ("ngn-crash-chain-" + std::to_string(getpid()));
    ngn::installCrashReport((dir / "crash.txt").string(), "ngn-test-host");
    // A library's handler, as glog's is: it calls the one before it once, then returns.
    struct sigaction mine{};
    mine.sa_handler = [](int signal) {
      if (gCalls++ == 0 && gChained.sa_handler != SIG_DFL && gChained.sa_handler != SIG_IGN) {
        gChained.sa_handler(signal);
      }
    };
    sigemptyset(&mine.sa_mask);
    sigaction(SIGSEGV, &mine, &gChained);
    raise(SIGSEGV);
    std::filesystem::remove_all(dir);
    _exit(0);
  }
  int status = 0;
  REQUIRE(waitpid(child, &status, 0) == child);
  std::error_code ignored;
  std::filesystem::remove_all(std::filesystem::temp_directory_path() / ("ngn-crash-chain-" + std::to_string(child)), ignored);
  CHECK(WIFSIGNALED(status));
}
#endif
