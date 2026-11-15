// The spawn capability rules, as @ng-native/device's spawn-rules.ts states them, enforced again in
// the core: a program the app spawns must match a capability its plugin options declared, whatever
// the JavaScript checked first. Each argument is a literal or a `{name:regex}` placeholder,
// anchored as a whole and never taking an option unless its pattern starts with `-`; a placeholder
// followed by `...` takes zero or more arguments. Shells and programs that run their arguments as
// a command are refused, a bare name runs only where it was pinned at startup on SEARCH_PATH, and
// no program or argument may hold a NUL.
#pragma once

#include <functional>
#include <map>
#include <optional>
#include <regex>
#include <stdexcept>
#include <string>
#include <vector>

namespace ngn {

struct SpawnCapability {
  std::string program;
  std::vector<std::string> args;
};

struct ArgumentRule {
  bool placeholder{false};
  // The literal, or the placeholder's name.
  std::string value;
  std::regex pattern;
  // Whether the pattern itself starts with `-`, so the value may be an option.
  bool option{false};
  bool repeated{false};
};

struct CompiledCapability {
  std::string program;
  std::vector<ArgumentRule> args;
};

class SpawnRuleError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

extern const std::vector<std::string> kSearchPath;

// Why `program` cannot be declared, or nothing when it can.
std::optional<std::string> programProblem(const std::string &program);

// Throws SpawnRuleError on a bad declaration.
ArgumentRule parseArgument(const std::string &arg);
CompiledCapability compileCapability(const SpawnCapability &capability);

bool matchArguments(const std::vector<ArgumentRule> &rules, const std::vector<std::string> &args);

// The path to run for `program` with `args`, or nothing when no capability allows it. `program`
// is the declared path or name exactly; a bare name runs only where `resolved` pinned it.
std::optional<std::string> matchSpawn(
    const std::vector<CompiledCapability> &capabilities,
    const std::string &program,
    const std::vector<std::string> &args,
    const std::map<std::string, std::optional<std::string>> &resolved);

struct ProgramLookup {
  std::function<bool(const std::string &path)> isExecutable;
  // A developer tool stub that only runs xcrun, with no Command Line Tools to run.
  std::function<bool(const std::string &path)> isStub;
};

// Where a declared program runs from, pinned once at startup, or nothing when it is absent.
std::optional<std::string> resolveProgram(const std::string &program, const ProgramLookup &lookup);

// Only the declared variables of `env`, and none holding a NUL.
std::map<std::string, std::string> filterEnvironment(
    const std::map<std::string, std::string> &env,
    const std::vector<std::string> &allowed);

} // namespace ngn
