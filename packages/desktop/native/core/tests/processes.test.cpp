#include "ngn/processes.h"

#include <doctest/doctest.h>
#include <set>

#include <map>
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
  int issued{0};
  int lastHandle() const override {
    return issued;
  }
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

TEST_CASE("a reloaded module never sends the old runtime's programs' events") {
  auto launcher = std::make_shared<FakeLauncher>();
  launcher->issued = 7;
  auto module = ngn::makeProcessesModule(launcher, setup());
  Lines events;
  module->setEmitter([&](const std::string &, dynamic body) { events.push_back(body["type"].asString() + " " + folly::toJson(body["handle"])); });
  launcher->events.output(7, false, "from before the reload");
  launcher->events.exit(7, 0, std::nullopt);
  launcher->events.output(8, false, "mine");
  launcher->events.exit(8, 0, std::nullopt);
  CHECK(events == Lines{"stdout 8", "exit 8"});
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
  CHECK_FALSE(ngn::externalUrlAllowed("VBScript:msgbox"));
  CHECK_FALSE(ngn::externalUrlAllowed("blob:https://a/b"));
  // The scheme is read from the very start: whitespace or a control character never hides one.
  CHECK_FALSE(ngn::externalUrlAllowed(" file:///etc/passwd"));
  CHECK_FALSE(ngn::externalUrlAllowed("\tjavascript:alert(1)"));
  CHECK_FALSE(ngn::externalUrlAllowed("java\nscript:alert(1)"));
  CHECK_FALSE(ngn::externalUrlAllowed("no scheme"));
  CHECK_FALSE(ngn::externalUrlAllowed("/Users/me"));
  CHECK(ngn::plainPath("/Users/me/notes.md"));
  CHECK_FALSE(ngn::plainPath("/Users/me/../../etc"));
  CHECK_FALSE(ngn::plainPath("relative/x"));
  CHECK_FALSE(ngn::plainPath("/a//b"));

  struct Opener final : ngn::ShellOpener {
    Lines calls;
    ngn::ShellOpener::PathFacts facts(const std::string &) override { return {.exists = true}; }
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

TEST_CASE("Shell.openPath opens a document or a folder, never something that runs: a program, an app or a script") {
  struct Opener final : ngn::ShellOpener {
    Lines calls;
    std::map<std::string, ngn::ShellOpener::PathFacts> disk;
    ngn::ShellOpener::PathFacts facts(const std::string &p) override {
      auto it = disk.find(p);
      return it == disk.end() ? ngn::ShellOpener::PathFacts{} : it->second;
    }
    void openUrl(const std::string &u, std::function<void(bool)> d) override { calls.push_back("url " + u); d(true); }
    void openPath(const std::string &p, std::function<void(bool)> d) override { calls.push_back("path " + p); d(true); }
    void showItemInFolder(const std::string &p, std::function<void(bool)> d) override { calls.push_back("show " + p); d(true); }
  };
  auto opener = std::make_shared<Opener>();
  opener->disk = {
      {"/Users/me/notes.md", {.exists = true}},
      {"/Users/me/Projects", {.exists = true}},
      {"/Users/me/tool", {.exists = true, .executable = true}},
      {"/Applications/Evil.app", {.exists = true, .runsCode = true}},
      {"/Users/me/run.command", {.exists = true, .runsCode = true}},
  };
  auto shell = ngn::makeShellModule(opener);
  std::vector<dynamic> answers;
  for (const char *path : {"/Users/me/notes.md", "/Users/me/Projects", "/Users/me/tool", "/Applications/Evil.app",
                           "/Users/me/run.command", "/Users/me/missing"}) {
    shell->callWithPromise("openPath", dynamic::array(path), {.resolve = [&](dynamic v) { answers.push_back(v); }, .reject = {}});
  }
  CHECK(answers == std::vector<dynamic>{true, true, false, false, false, false});
  CHECK(opener->calls == Lines{"path /Users/me/notes.md", "path /Users/me/Projects"});

  // Showing one in Finder runs nothing, so any that exists can be shown.
  answers.clear();
  shell->callWithPromise("showItemInFolder", dynamic::array("/Applications/Evil.app"),
                         {.resolve = [&](dynamic v) { answers.push_back(v); }, .reject = {}});
  CHECK(answers == std::vector<dynamic>{true});
}

TEST_CASE("the POSIX launcher's stdin writes never block the caller, and a closed reader never raises SIGPIPE") {
  auto launcher = ngn::makePosixLauncher();
  std::mutex mutex;
  std::condition_variable done;
  std::map<int, size_t> received;
  std::set<int> exited;
  launcher->setEvents({
      .output = [&](int h, bool, std::string data) { std::lock_guard lock(mutex); received[h] += data.size(); },
      .exit =
          [&](int h, std::optional<int>, std::optional<std::string>) {
            std::lock_guard lock(mutex);
            exited.insert(h);
            done.notify_all();
          },
  });
  auto wait = [&](int h) {
    std::unique_lock lock(mutex);
    return done.wait_for(lock, std::chrono::seconds(10), [&] { return exited.contains(h); });
  };
  const std::string big(4 * 1024 * 1024, 'x');

  // A program that never reads: the write is queued, not waited on.
  auto idle = std::get<int>(launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {}));
  auto started = std::chrono::steady_clock::now();
  launcher->write(idle, big);
  CHECK(std::chrono::steady_clock::now() - started < std::chrono::milliseconds(500));
  // Nor does a write hold up calls for other programs.
  CHECK(launcher->lastHandle() == idle);
  launcher->kill(idle, SIGKILL);
  REQUIRE(wait(idle));

  // A reader that takes it all, in its own time.
  auto cat = std::get<int>(launcher->spawn("/bin/cat", {}, std::nullopt, {}));
  launcher->write(cat, big);
  launcher->write(cat, "end");
  launcher->closeStdin(cat);
  REQUIRE(wait(cat));
  CHECK(received[cat] == big.size() + 3);

  // A program that closed its stdin: writing to it would raise SIGPIPE, which ends the host.
  auto closed = std::get<int>(launcher->spawn("/bin/sh", {"-c", "exec 0<&-; sleep 2"}, std::nullopt, {}));
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  launcher->write(closed, "anyone there?");
  launcher->write(closed, big);
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  launcher->kill(closed, SIGKILL);
  REQUIRE(wait(closed));
}
