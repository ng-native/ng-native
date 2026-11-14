// The core's copy of the spawn rules, held to the cases @ng-native/device's spawn-rules.test.ts
// holds the TypeScript to: most of them attempts to get past the rules.
#include "ngn/spawn-rules.h"

#include <doctest/doctest.h>

using ngn::SpawnCapability;

namespace {

using Pinned = std::map<std::string, std::optional<std::string>>;

bool allows(std::vector<SpawnCapability> entries, const std::string &program, std::vector<std::string> args, Pinned pinned = {}) {
  std::vector<ngn::CompiledCapability> compiled;
  for (const auto &entry : entries) {
    compiled.push_back(ngn::compileCapability(entry));
  }
  return ngn::matchSpawn(compiled, program, args, pinned).has_value();
}

const SpawnCapability kGitClone{"/usr/bin/git", {"clone", "{url:https://[^\\s]+}", "{dir:[\\w.-]+}"}};

ngn::ProgramLookup at(std::vector<std::string> executables, std::vector<std::string> stubs = {}) {
  return {
      .isExecutable = [executables](const std::string &p) {
        return std::find(executables.begin(), executables.end(), p) != executables.end();
      },
      .isStub = [stubs](const std::string &p) { return std::find(stubs.begin(), stubs.end(), p) != stubs.end(); },
  };
}

} // namespace

TEST_CASE("a declared program is an absolute normalized path or a bare name, never a shell or batch file") {
  CHECK_FALSE(ngn::programProblem("/usr/bin/git"));
  CHECK_FALSE(ngn::programProblem("git"));
  CHECK(ngn::programProblem("./tool")->find("relative") != std::string::npos);
  CHECK(ngn::programProblem("bin/tool"));
  CHECK(ngn::programProblem("..\\tool"));
  CHECK(ngn::programProblem("/usr/bin/../../bin/sh2")->find("normalized") != std::string::npos);
  CHECK(ngn::programProblem("/usr/./bin/git"));
  CHECK(ngn::programProblem("/usr//bin/git"));
  CHECK(ngn::programProblem("/usr/bin/"));
  for (const char *shell : {"sh", "/bin/bash", "/bin/zsh", "env", "/usr/bin/env", "xargs", "sudo", "osascript", "BASH",
                            "pwsh.exe", "/usr/local/bin/fish"}) {
    CAPTURE(shell);
    CHECK(ngn::programProblem(shell));
  }
  CHECK(ngn::programProblem("C:\\tools\\build.bat")->find("batch file") != std::string::npos);
  CHECK(ngn::programProblem("/Users/me/run.CMD"));
  CHECK(ngn::programProblem(std::string("/usr/bin/git\0/bin/sh", 20)));
  CHECK(ngn::programProblem(" git"));
  CHECK(ngn::programProblem(""));
  CHECK_THROWS_AS(ngn::compileCapability({"/bin/sh", {"-c", "{cmd:.*}"}}), ngn::SpawnRuleError);
}

TEST_CASE("a declaration with a bad pattern, an escaping one or two placeholders alike is refused") {
  CHECK_THROWS_AS(ngn::compileCapability({"git", {"{x:[}"}}), ngn::SpawnRuleError);
  CHECK_THROWS_AS(ngn::compileCapability({"git", {"{x:a)|(.*}"}}), ngn::SpawnRuleError);
  CHECK_THROWS_AS(ngn::compileCapability({"git", {"{a:x}", "{a:y}"}}), ngn::SpawnRuleError);
  CHECK_THROWS_AS(ngn::compileCapability({"git", {"{a:x}...", "{b:y}..."}}), ngn::SpawnRuleError);
  CHECK_FALSE(ngn::parseArgument("{not a placeholder}").placeholder);
}

TEST_CASE("literals match exactly, and a placeholder only by its whole pattern") {
  SpawnCapability status{"/usr/bin/git", {"status", "--porcelain"}};
  CHECK(allows({status}, "/usr/bin/git", {"status", "--porcelain"}));
  CHECK_FALSE(allows({status}, "/usr/bin/git", {"status"}));
  CHECK_FALSE(allows({status}, "/usr/bin/git", {"status", "--porcelain", "-z"}));
  CHECK_FALSE(allows({status}, "/usr/bin/git", {"--porcelain", "status"}));
  CHECK_FALSE(allows({status}, "/usr/bin/git", {"Status", "--porcelain"}));
  CHECK(allows({kGitClone}, "/usr/bin/git", {"clone", "https://x.dev/a.git", "a"}));

  SpawnCapability branch{"git", {"checkout", "{branch:[a-z]+}"}};
  Pinned pinned{{"git", "/usr/bin/git"}};
  CHECK(allows({branch}, "git", {"checkout", "main"}, pinned));
  CHECK_FALSE(allows({branch}, "git", {"checkout", "main;rm -rf ~"}, pinned));
  CHECK_FALSE(allows({branch}, "git", {"checkout", "--upload-pack=touch /tmp/x"}, pinned));
  CHECK_FALSE(allows({branch}, "git", {"checkout", "main\nother"}, pinned));

  SpawnCapability either{"/usr/bin/tool", {"{mode:fast|slow}"}};
  CHECK(allows({either}, "/usr/bin/tool", {"slow"}));
  CHECK_FALSE(allows({either}, "/usr/bin/tool", {"fast; reboot"}));
  CHECK_FALSE(allows({either}, "/usr/bin/tool", {"x slow"}));
}

TEST_CASE("a placeholder takes no option unless its pattern starts with -, and no NUL ever") {
  SpawnCapability anything{"/usr/bin/tool", {"{value:.*}"}};
  CHECK(allows({anything}, "/usr/bin/tool", {"ok"}));
  CHECK_FALSE(allows({anything}, "/usr/bin/tool", {"-rf"}));
  CHECK_FALSE(allows({anything}, "/usr/bin/tool", {"--output=/etc/passwd"}));
  SpawnCapability flag{"/usr/bin/tool", {"{flag:-v|--verbose}"}};
  CHECK(allows({flag}, "/usr/bin/tool", {"-v"}));
  CHECK(allows({flag}, "/usr/bin/tool", {"--verbose"}));
  CHECK_FALSE(allows({flag}, "/usr/bin/tool", {"--exec=x"}));

  SpawnCapability name{"/usr/bin/tool", {"{name:[\\w.]+}"}};
  for (const char *value : {"$(reboot)", "`id`", "a|b", "a&&b", "a;b", "$HOME", "a>b", "*"}) {
    CAPTURE(value);
    CHECK_FALSE(allows({name}, "/usr/bin/tool", {value}));
  }
  SpawnCapability any{"/usr/bin/tool", {"{x:[\\s\\S]*}"}};
  CHECK_FALSE(allows({any}, "/usr/bin/tool", {std::string("ok\0--evil", 9)}));
  SpawnCapability literal{"/usr/bin/tool", {"ok"}};
  CHECK_FALSE(allows({literal}, "/usr/bin/tool", {std::string("ok\0", 3)}));

  SpawnCapability file{"/usr/bin/tool", {"{file:[\\w-]+\\.txt}"}};
  CHECK(allows({file}, "/usr/bin/tool", {"notes.txt"}));
  CHECK_FALSE(allows({file}, "/usr/bin/tool", {"../../etc/passwd.txt"}));
  CHECK_FALSE(allows({file}, "/usr/bin/tool", {"/etc/x.txt"}));
}

TEST_CASE("a repeated placeholder takes zero or more arguments, with the literals after it at the end") {
  SpawnCapability add{"/usr/bin/git", {"add", "--", "{files:[\\w./]+}..."}};
  CHECK(allows({add}, "/usr/bin/git", {"add", "--"}));
  CHECK(allows({add}, "/usr/bin/git", {"add", "--", "a.ts", "src/b.ts"}));
  CHECK_FALSE(allows({add}, "/usr/bin/git", {"add", "--", "a", "-f"}));
  CHECK_FALSE(allows({add}, "/usr/bin/git", {"add", "--", "a", "b c"}));
  SpawnCapability convert{"/usr/bin/tool", {"{inputs:\\w+}...", "-o", "{out:\\w+}"}};
  CHECK(allows({convert}, "/usr/bin/tool", {"a", "b", "-o", "c"}));
  CHECK(allows({convert}, "/usr/bin/tool", {"-o", "c"}));
  CHECK_FALSE(allows({convert}, "/usr/bin/tool", {"a", "-o"}));
  CHECK_FALSE(allows({convert}, "/usr/bin/tool", {"a", "b", "c"}));
}

TEST_CASE("the program matches as declared, and a bare name only where it was pinned") {
  CHECK_FALSE(allows({kGitClone}, "git", {"clone", "https://x", "a"}));
  CHECK_FALSE(allows({kGitClone}, "/tmp/git", {"clone", "https://x", "a"}));
  CHECK_FALSE(allows({kGitClone}, "/usr/bin/../bin/git", {"clone", "https://x", "a"}));
  SpawnCapability status{"git", {"status"}};
  CHECK_FALSE(allows({status}, "git", {"status"}));
  CHECK_FALSE(allows({status}, "git", {"status"}, {{"git", std::nullopt}}));
  Pinned pinned{{"git", "/opt/homebrew/bin/git"}};
  CHECK(ngn::matchSpawn({ngn::compileCapability(status)}, "git", {"status"}, pinned) == "/opt/homebrew/bin/git");
  CHECK(allows({status}, "/opt/homebrew/bin/git", {"status"}, pinned));
  CHECK_FALSE(allows({status}, "/usr/bin/git", {"status"}, pinned));
  // Each capability in turn.
  SpawnCapability log{"/usr/bin/git", {"log", "{n:-n\\d+}"}};
  CHECK(allows({status, log}, "/usr/bin/git", {"log", "-n5"}));
  CHECK_FALSE(allows({status, log}, "/usr/bin/git", {"log", "-n5; x"}));
}

TEST_CASE("a bare name resolves on the system folders then Homebrew's, never the inherited PATH") {
  CHECK(ngn::kSearchPath == std::vector<std::string>{"/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"});
  CHECK(ngn::resolveProgram("git", at({"/usr/bin/git", "/opt/homebrew/bin/git"})) == "/usr/bin/git");
  CHECK(ngn::resolveProgram("ffmpeg", at({"/opt/homebrew/bin/ffmpeg"})) == "/opt/homebrew/bin/ffmpeg");
  CHECK_FALSE(ngn::resolveProgram("git", at({"/tmp/evil/git"})));
  CHECK_FALSE(ngn::resolveProgram("nothing", at({})));
  CHECK_FALSE(ngn::resolveProgram("git", at({"/usr/bin/git"}, {"/usr/bin/git"})));
  CHECK(ngn::resolveProgram("/usr/bin/git", at({"/usr/bin/git"})) == "/usr/bin/git");
  CHECK_FALSE(ngn::resolveProgram("/usr/bin/git", at({})));
  CHECK_FALSE(ngn::resolveProgram("sh", at({"/bin/sh"})));
}

TEST_CASE("a spawned program's environment holds only the declared variables") {
  std::map<std::string, std::string> env{{"HOME", "/Users/me"}, {"LANG", "en"}, {"SECRET", "x"}, {"A", std::string("x\0y", 3)}};
  CHECK(ngn::filterEnvironment(env, {"HOME", "LANG", "MISSING", "A"}) ==
        std::map<std::string, std::string>{{"HOME", "/Users/me"}, {"LANG", "en"}});
}
