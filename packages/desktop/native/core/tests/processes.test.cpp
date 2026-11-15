#include "helpers.h"
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

#include <sys/wait.h>
#include <unistd.h>

using folly::dynamic;

namespace {

using Lines = std::vector<std::string>;

struct FakeLauncher final : ngn::ProcessLauncher {
  Lines calls;
  int issued{0};
  // The program exits before spawn answers its handle, as a short one can on a real launcher.
  bool exitsAtOnce{false};
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
    if (exitsAtOnce) {
      events.exit(7, 0, std::nullopt);
    }
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
  void killAll(int signal) override {
    calls.push_back("kill all " + std::to_string(signal));
  }
};

// What a real launcher's callbacks record. The callbacks hold it, so one that runs after a failed
// wait has ended the test still has somewhere to write.
struct Recorded {
  std::mutex mutex;
  std::condition_variable done;
  std::map<int, std::string> output;
  std::map<int, size_t> received;
  std::map<int, std::string> exits;

  bool wait(int handle) {
    std::unique_lock lock(mutex);
    return done.wait_for(lock, std::chrono::seconds(10), [&] { return exits.contains(handle); });
  }
};

// A real launcher whose events go to a Recorded, and whose programs are all stopped, and their exits
// heard, when the test ends, however it ends.
struct RealLauncher {
  std::shared_ptr<ngn::ProcessLauncher> launcher = ngn::makePosixLauncher();
  std::shared_ptr<Recorded> recorded = std::make_shared<Recorded>();
  RealLauncher() {
    launcher->setEvents({
        .output =
            [recorded = recorded](int h, bool, std::string data) {
              std::lock_guard lock(recorded->mutex);
              recorded->received[h] += data.size();
              recorded->output[h] += data;
              recorded->done.notify_all();
            },
        .exit =
            [recorded = recorded](int h, std::optional<int> code, std::optional<std::string> signal) {
              std::lock_guard lock(recorded->mutex);
              recorded->exits[h] = code ? "code " + std::to_string(*code) : signal.value_or("");
              recorded->done.notify_all();
            },
    });
  }
  RealLauncher(const RealLauncher &) = delete;
  RealLauncher &operator=(const RealLauncher &) = delete;
  // Stops every program and waits, up to ten seconds, for each one's exit to be reported, so no
  // program or reader thread of this test is still running when the next one starts.
  ~RealLauncher() {
    launcher->killAll(SIGKILL);
    int last = launcher->lastHandle();
    std::unique_lock lock(recorded->mutex);
    recorded->done.wait_for(lock, std::chrono::seconds(10), [&] {
      for (int handle = 1; handle <= last; handle++) {
        if (!recorded->exits.contains(handle)) {
          return false;
        }
      }
      return true;
    });
  }
  ngn::ProcessLauncher *operator->() const {
    return launcher.get();
  }
  bool wait(int handle) const {
    return recorded->wait(handle);
  }
  std::string output(int handle) const {
    std::lock_guard lock(recorded->mutex);
    return recorded->output[handle];
  }
  size_t received(int handle) const {
    std::lock_guard lock(recorded->mutex);
    return recorded->received[handle];
  }
  std::string exit(int handle) const {
    std::lock_guard lock(recorded->mutex);
    return recorded->exits[handle];
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
  RealLauncher launcher;
  auto wait = [&](int h) { return launcher.wait(h); };
  auto output = [&](int h) { return launcher.output(h); };
  auto exits = [&](int h) { return launcher.exit(h); };

  auto env = launcher->spawn("/usr/bin/env", {}, std::string("/"), {{"ONLY", "this"}});
  REQUIRE(std::holds_alternative<int>(env));
  REQUIRE(wait(std::get<int>(env)));
  CHECK(output(std::get<int>(env)) == "ONLY=this\n");
  CHECK(exits(std::get<int>(env)) == "code 0");

  auto cat = launcher->spawn("/bin/cat", {}, std::nullopt, {});
  REQUIRE(std::holds_alternative<int>(cat));
  launcher->write(std::get<int>(cat), "hello; $(reboot)");
  launcher->closeStdin(std::get<int>(cat));
  REQUIRE(wait(std::get<int>(cat)));
  CHECK(output(std::get<int>(cat)) == "hello; $(reboot)");

  auto sleeper = launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {});
  REQUIRE(std::holds_alternative<int>(sleeper));
  launcher->kill(std::get<int>(sleeper), SIGTERM);
  REQUIRE(wait(std::get<int>(sleeper)));
  CHECK(exits(std::get<int>(sleeper)) == "SIGTERM");

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
  auto shell = ngn::makeShellModule(opener, ngn::testing::readsEverywhere());
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
  auto shell = ngn::makeShellModule(opener, ngn::testing::readsEverywhere());
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

TEST_CASE("Shell.openPath and showItemInFolder take a path only inside the file boundary, before looking at it") {
  struct Opener final : ngn::ShellOpener {
    Lines calls;
    ngn::ShellOpener::PathFacts facts(const std::string &p) override {
      calls.push_back("facts " + p);
      return {.exists = true};
    }
    void openUrl(const std::string &, std::function<void(bool)> d) override { d(true); }
    void openPath(const std::string &p, std::function<void(bool)> d) override { calls.push_back("path " + p); d(true); }
    void showItemInFolder(const std::string &p, std::function<void(bool)> d) override { calls.push_back("show " + p); d(true); }
  };
  auto opener = std::make_shared<Opener>();
  auto access = std::make_shared<ngn::FileAccess>(
      ngn::FileAccess::Folders{.document = "/app/Documents", .home = "/Users/me"},
      dynamic::array(dynamic::object("path", "~/Reports")("access", "read")));
  auto shell = ngn::makeShellModule(opener, access);
  std::vector<dynamic> answers;
  auto ask = [&](const char *method, const char *arg) {
    shell->callWithPromise(method, dynamic::array(arg), {.resolve = [&](dynamic v) { answers.push_back(v); }, .reject = {}});
  };
  ask("openPath", "/Users/me/Desktop/private.pdf");
  ask("showItemInFolder", "/Users/me/.ssh/id_ed25519");
  CHECK(answers == std::vector<dynamic>{false, false});
  CHECK(opener->calls.empty());
  ask("openPath", "/app/Documents/a.pdf");
  ask("showItemInFolder", "/Users/me/Reports/q3.pdf");
  CHECK(answers == std::vector<dynamic>{false, false, true, true});
  CHECK(opener->calls == Lines{"facts /app/Documents/a.pdf", "path /app/Documents/a.pdf", "show /Users/me/Reports/q3.pdf"});
  // Without file access, no path at all.
  auto closed = ngn::makeShellModule(opener, nullptr);
  closed->callWithPromise("openPath", dynamic::array("/app/Documents/a.pdf"), {.resolve = [&](dynamic v) { answers.push_back(v); }, .reject = {}});
  CHECK(answers.back() == false);
}

TEST_CASE("the POSIX launcher's stdin writes never block the caller, and a closed reader never raises SIGPIPE") {
  RealLauncher launcher;
  auto wait = [&](int h) { return launcher.wait(h); };
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
  CHECK(launcher.received(cat) == big.size() + 3);

  // A program that closed its stdin: writing to it would raise SIGPIPE, which ends the host. It
  // says so once it has, so the writes come after.
  auto closed = std::get<int>(launcher->spawn("/bin/sh", {"-c", "exec 0<&-; echo closed; sleep 2"}, std::nullopt, {}));
  {
    std::unique_lock lock(launcher.recorded->mutex);
    REQUIRE(launcher.recorded->done.wait_for(lock, std::chrono::seconds(10), [&] {
      return launcher.recorded->output[closed] == "closed\n";
    }));
  }
  launcher->write(closed, "anyone there?");
  launcher->write(closed, big);
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  launcher->kill(closed, SIGKILL);
  REQUIRE(wait(closed));
}

TEST_CASE("a module going, as on a reload, stops the programs it started that are still running") {
  auto launcher = std::make_shared<FakeLauncher>();
  {
    auto module = ngn::makeProcessesModule(launcher, setup());
    REQUIRE(spawn(*module, dynamic::array("git", dynamic::array("status", "--porcelain"))).value == dynamic(7));
  }
  CHECK(launcher->calls.back() == "kill 7 " + std::to_string(SIGTERM));

  // One that already exited is left alone.
  launcher->calls.clear();
  {
    auto module = ngn::makeProcessesModule(launcher, setup());
    launcher->issued = 6;
    REQUIRE(spawn(*module, dynamic::array("git", dynamic::array("status", "--porcelain"))).value == dynamic(7));
    launcher->events.exit(7, 0, std::nullopt);
  }
  CHECK(launcher->calls.size() == 1);
}

TEST_CASE("a program that exits before spawn answers is not stopped again when the module goes") {
  auto launcher = std::make_shared<FakeLauncher>();
  launcher->exitsAtOnce = true;
  {
    auto module = ngn::makeProcessesModule(launcher, setup());
    REQUIRE(spawn(*module, dynamic::array("git", dynamic::array("status", "--porcelain"))).value == dynamic(7));
  }
  CHECK(launcher->calls.size() == 1);
}

TEST_CASE("the POSIX launcher stops every program it started, for the host quitting") {
  RealLauncher launcher;
  auto a = std::get<int>(launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {}));
  auto b = std::get<int>(launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {}));
  launcher->killAll(SIGKILL);
  REQUIRE(launcher.wait(a));
  REQUIRE(launcher.wait(b));
  CHECK(launcher.exit(a) == "SIGKILL");
  CHECK(launcher.exit(b) == "SIGKILL");
}

TEST_CASE("a test's real launcher has every program it started exited before the next test begins") {
  std::shared_ptr<Recorded> recorded;
  int a = 0;
  int b = 0;
  {
    RealLauncher launcher;
    recorded = launcher.recorded;
    a = std::get<int>(launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {}));
    b = std::get<int>(launcher->spawn("/bin/sleep", {"30"}, std::nullopt, {}));
  }
  std::lock_guard lock(recorded->mutex);
  CHECK(recorded->exits[a] == "SIGKILL");
  CHECK(recorded->exits[b] == "SIGKILL");
}

TEST_CASE("the POSIX launcher forgets a program while its pid is still held, so a kill never reaches a reused pid") {
  pid_t pid = fork();
  REQUIRE(pid >= 0);
  if (pid == 0) {
    _exit(3);
  }
  bool heldWhenForgotten = false;
  int status = ngn::reapAfter(pid, [&] {
    // The program has exited but is not reaped: its pid is still its own, not free for reuse.
    heldWhenForgotten = ::kill(pid, 0) == 0;
  });
  CHECK(heldWhenForgotten);
  CHECK(WIFEXITED(status));
  CHECK(WEXITSTATUS(status) == 3);
  // Reaped now.
  CHECK(::kill(pid, 0) == -1);
}
