#include "ngn/processes.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <chrono>
#include <condition_variable>
#include <csignal>
#include <mutex>
#include <thread>

using folly::dynamic;

namespace {

using Lines = std::vector<std::string>;

struct FakeLauncher final : ngn::ProcessLauncher {
  Lines calls;
  Events events;
  void setEvents(Events e) override {
    events = std::move(e);
  }
  std::variant<int, std::string> spawn(
      const std::string &path,
      const std::vector<std::string> &args,
      const std::optional<std::string> &cwd,
      const std::map<std::string, std::string> &env) override {
    std::string line = "spawn " + path;
    for (const auto &a : args) {
      line += " " + a;
    }
    line += " in " + cwd.value_or("-") + " with";
    for (const auto &[k, v] : env) {
      line += " " + k + "=" + v;
    }
    calls.push_back(line);
    return 7;
  }
  void write(int handle, const std::string &data) override {
    calls.push_back("write " + std::to_string(handle) + " " + data);
  }
  void closeStdin(int handle) override {
    calls.push_back("close " + std::to_string(handle));
  }
  void kill(int handle, int signal) override {
    calls.push_back("kill " + std::to_string(handle) + " " + std::to_string(signal));
  }
};

dynamic gitCapabilities() {
  return dynamic::object(
      "spawn",
      dynamic::array(
          dynamic::object("program", "git")("args", dynamic::array("status", "--porcelain")),
          dynamic::object("program", "/usr/bin/tool")("args", dynamic::array("{name:[\\w.]+}")),
          dynamic::object("program", "/bin/sh")("args", dynamic::array("-c", "{cmd:.*}"))))(
      "env", dynamic::array("HOME", "LANG"));
}

ngn::ProcessesSetup setup(bool sandboxed = false) {
  return {
      .capabilities = ngn::parseCapabilities(gitCapabilities()),
      .environment = {{"HOME", "/Users/me"}, {"LANG", "en"}, {"SECRET", "token"}},
      .lookup = {.isExecutable = [](const std::string &p) { return p == "/opt/homebrew/bin/git"; }},
      .sandboxed = sandboxed,
  };
}

struct Result {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Result spawn(const ngn::NativeModule &module, dynamic args) {
  Result result;
  module.callWithPromise(
      "spawn", args,
      {.resolve = [&](dynamic v) { result.value = v; }, .reject = [&](const std::string &e) { result.error = e; }});
  return result;
}

} // namespace

TEST_CASE("the module's constants are the declared environment, capabilities and where each name was pinned") {
  auto launcher = std::make_shared<FakeLauncher>();
  auto module = ngn::makeProcessesModule(launcher, setup());
  auto constants = module->call("getConstants");
  CHECK(constants["env"] == dynamic::object("HOME", "/Users/me")("LANG", "en"));
  CHECK(constants["envNames"] == dynamic::array("HOME", "LANG"));
  // The shell is a bad declaration: never declared to the app, never allowed.
  CHECK(constants["spawn"].size() == 2);
  CHECK(constants["resolved"] == dynamic::object("git", "/opt/homebrew/bin/git"));
}

TEST_CASE("the core runs only what a capability allows, whatever the JavaScript asked") {
  auto launcher = std::make_shared<FakeLauncher>();
  auto module = ngn::makeProcessesModule(launcher, setup());
  auto ok = spawn(*module, dynamic::array("git", dynamic::array("status", "--porcelain"), "/repo",
                                          dynamic::object("HOME", "/Users/me")("SECRET", "token")("PATH", "/tmp")));
  CHECK(ok.value == dynamic(7));
  // The pinned path runs, in the directory given, with only the declared variables.
  CHECK(launcher->calls == Lines{"spawn /opt/homebrew/bin/git status --porcelain in /repo with HOME=/Users/me"});

  launcher->calls.clear();
  for (auto args : {
           dynamic::array("git", dynamic::array("status")),
           dynamic::array("git", dynamic::array("status", "--porcelain", "-c", "core.pager=sh")),
           dynamic::array("/usr/bin/git", dynamic::array("status", "--porcelain")),
           dynamic::array("/usr/bin/tool", dynamic::array("$(reboot)")),
           dynamic::array("/usr/bin/tool", dynamic::array("--output=/etc/passwd")),
           dynamic::array("/usr/bin/tool", dynamic::array(std::string("ok\0-x", 5))),
           dynamic::array("/bin/sh", dynamic::array("-c", "reboot")),
           dynamic::array("/usr/bin/tool", dynamic::array("ok"), "../escape"),
       }) {
    CAPTURE(folly::toJson(args));
    auto refused = spawn(*module, args);
    CHECK(refused.error);
  }
  CHECK(launcher->calls.empty());
}

TEST_CASE("a sandboxed build runs nothing") {
  auto launcher = std::make_shared<FakeLauncher>();
  auto module = ngn::makeProcessesModule(launcher, setup(true));
  CHECK(module->call("getConstants")["spawn"].empty());
  CHECK(spawn(*module, dynamic::array("git", dynamic::array("status", "--porcelain"))).error);
  CHECK(launcher->calls.empty());
}

TEST_CASE("stdin, kill and the program's output and exit go through the module") {
  auto launcher = std::make_shared<FakeLauncher>();
  auto module = ngn::makeProcessesModule(launcher, setup());
  Lines events;
  module->setEmitter([&](const std::string &event, dynamic body) {
    events.push_back(event + " " + body["type"].asString() + " " + folly::toJson(body["handle"]));
  });
  module->call("write", dynamic::array(7, "hi"));
  module->call("closeStdin", dynamic::array(7));
  module->call("kill", dynamic::array(7, "SIGKILL"));
  module->call("kill", dynamic::array(7, "SIGSTOP"));
  CHECK(launcher->calls == Lines{"write 7 hi", "close 7", "kill 7 " + std::to_string(SIGKILL)});
  launcher->events.output(7, false, "out");
  launcher->events.output(7, true, "err");
  launcher->events.exit(7, 0, std::nullopt);
  CHECK(events == Lines{"ngNativeProcesses stdout 7", "ngNativeProcesses stderr 7", "ngNativeProcesses exit 7"});
}

TEST_CASE("the POSIX launcher runs a real program with only the environment given") {
  auto launcher = ngn::makePosixLauncher();
  std::mutex mutex;
  std::condition_variable done;
  std::map<int, std::string> output;
  std::map<int, std::string> exits;
  launcher->setEvents({
      .output = [&](int h, bool, std::string data) { std::lock_guard lock(mutex); output[h] += data; },
      .exit =
          [&](int h, std::optional<int> code, std::optional<std::string> signal) {
            std::lock_guard lock(mutex);
            exits[h] = code ? "code " + std::to_string(*code) : *signal;
            done.notify_all();
          },
  });
  auto wait = [&](int h) {
    std::unique_lock lock(mutex);
    return done.wait_for(lock, std::chrono::seconds(10), [&] { return exits.contains(h); });
  };

  auto env = launcher->spawn("/usr/bin/env", {}, std::string("/"), {{"ONLY", "this"}});
  REQUIRE(std::holds_alternative<int>(env));
  REQUIRE(wait(std::get<int>(env)));
  CHECK(output[std::get<int>(env)] == "ONLY=this\n");
  CHECK(exits[std::get<int>(env)] == "code 0");

  auto cat = launcher->spawn("/bin/cat", {}, std::nullopt, {});
  REQUIRE(std::holds_alternative<int>(cat));
  launcher->write(std::get<int>(cat), "hello; $(reboot)");
  launcher->closeStdin(std::get<int>(cat));
  REQUIRE(wait(std::get<int>(cat)));
  CHECK(output[std::get<int>(cat)] == "hello; $(reboot)");

  auto sleeper = launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {});
  REQUIRE(std::holds_alternative<int>(sleeper));
  launcher->kill(std::get<int>(sleeper), SIGTERM);
  REQUIRE(wait(std::get<int>(sleeper)));
  CHECK(exits[std::get<int>(sleeper)] == "SIGTERM");

  CHECK(std::holds_alternative<std::string>(launcher->spawn("/nonexistent/tool", {}, std::nullopt, {})));
}

TEST_CASE("Shell hands on urls with a scheme that is not a file's or a script's, and plain paths only") {
  CHECK(ngn::externalUrlAllowed("https://ng-native.com"));
  CHECK(ngn::externalUrlAllowed("mailto:a@b.c"));
  CHECK_FALSE(ngn::externalUrlAllowed("file:///etc/passwd"));
  CHECK_FALSE(ngn::externalUrlAllowed("JavaScript:alert(1)"));
  CHECK_FALSE(ngn::externalUrlAllowed("data:text/html,x"));
  CHECK_FALSE(ngn::externalUrlAllowed("no scheme"));
  CHECK_FALSE(ngn::externalUrlAllowed("/Users/me"));
  CHECK(ngn::plainPath("/Users/me/notes.md"));
  CHECK_FALSE(ngn::plainPath("/Users/me/../../etc"));
  CHECK_FALSE(ngn::plainPath("relative/x"));
  CHECK_FALSE(ngn::plainPath("/a//b"));

  struct Opener final : ngn::ShellOpener {
    Lines calls;
    void openUrl(const std::string &u, std::function<void(bool)> d) override { calls.push_back("url " + u); d(true); }
    void openPath(const std::string &p, std::function<void(bool)> d) override { calls.push_back("path " + p); d(true); }
    void showItemInFolder(const std::string &p, std::function<void(bool)> d) override { calls.push_back("show " + p); d(false); }
  };
  auto opener = std::make_shared<Opener>();
  auto shell = ngn::makeShellModule(opener);
  std::vector<dynamic> answers;
  auto ask = [&](const char *method, const char *arg) {
    shell->callWithPromise(method, dynamic::array(arg), {.resolve = [&](dynamic v) { answers.push_back(v); }, .reject = {}});
  };
  ask("openExternal", "https://ng-native.com");
  ask("openExternal", "file:///etc/passwd");
  ask("openPath", "/Users/me/a.md");
  ask("openPath", "/Users/me/../x");
  ask("showItemInFolder", "/Users/me/a.md");
  CHECK(answers == std::vector<dynamic>{true, false, true, false, false});
  CHECK(opener->calls == Lines{"url https://ng-native.com", "path /Users/me/a.md", "show /Users/me/a.md"});
}
