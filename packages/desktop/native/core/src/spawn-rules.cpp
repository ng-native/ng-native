#include "ngn/spawn-rules.h"

#include <algorithm>
#include <cctype>
#include <set>

namespace ngn {

const std::vector<std::string> kSearchPath{
    "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"};

namespace {

const std::set<std::string> kRefusedPrograms{
    "sh",  "bash",  "zsh",  "dash", "ksh",  "mksh", "csh", "tcsh",      "fish", "nu",
    "env", "xargs", "sudo", "doas", "su",   "osascript", "cmd", "powershell", "pwsh"};

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
  return s;
}

bool hasNul(const std::string &s) {
  return s.find('\0') != std::string::npos;
}

bool endsWith(const std::string &s, const std::string &end) {
  return s.size() >= end.size() && s.compare(s.size() - end.size(), end.size(), end) == 0;
}

std::string baseName(const std::string &program) {
  auto at = program.find_last_of("\\/");
  std::string last = at == std::string::npos ? program : program.substr(at + 1);
  last = lower(last);
  if (endsWith(last, ".exe")) {
    last.resize(last.size() - 4);
  }
  return last;
}

std::vector<std::string> segments(const std::string &path) {
  std::vector<std::string> out;
  size_t start = 0;
  while (true) {
    auto slash = path.find('/', start);
    out.push_back(path.substr(start, slash == std::string::npos ? std::string::npos : slash - start));
    if (slash == std::string::npos) {
      return out;
    }
    start = slash + 1;
  }
}

bool passes(const ArgumentRule &rule, const std::string &arg) {
  if (!arg.empty() && arg[0] == '-' && !rule.option) {
    return false;
  }
  return std::regex_match(arg, rule.pattern);
}

bool fits(const ArgumentRule &rule, const std::string &arg) {
  return rule.placeholder ? passes(rule, arg) : rule.value == arg;
}

} // namespace

std::optional<std::string> programProblem(const std::string &program) {
  if (program.empty()) {
    return "a program is required";
  }
  if (hasNul(program)) {
    return "a program cannot hold a NUL character";
  }
  if (std::isspace(static_cast<unsigned char>(program.front())) ||
      std::isspace(static_cast<unsigned char>(program.back()))) {
    return "a program cannot start or end with white space";
  }
  auto l = lower(program);
  if (endsWith(l, ".bat") || endsWith(l, ".cmd")) {
    return program + " is a batch file, which runs through cmd.exe and re-parses its arguments";
  }
  if (kRefusedPrograms.contains(baseName(program))) {
    return program + " runs its arguments as a command, so it cannot be declared";
  }
  if (program[0] == '/') {
    auto parts = segments(program.substr(1));
    for (const auto &part : parts) {
      if (part.empty() || part == "." || part == "..") {
        return program + " is not a normalized absolute path";
      }
    }
    return std::nullopt;
  }
  if (program.find_first_of("\\/") != std::string::npos) {
    return program + " is a relative path: give an absolute path or a bare name";
  }
  if (program == "." || program == "..") {
    return program + " is not a program";
  }
  return std::nullopt;
}

// A pattern's top-level alternatives: `-v|.*` is `-v` and `.*`. A `|` in a group, in a class or
// escaped is not one. The pattern has compiled, so its groups and classes are balanced.
static std::vector<std::string> topLevelAlternatives(const std::string &source) {
  std::vector<std::string> found;
  int depth = 0;
  bool inClass = false;
  size_t start = 0;
  for (size_t at = 0; at < source.size(); at++) {
    char c = source[at];
    if (c == '\\') {
      at++;
    } else if (inClass) {
      inClass = c != ']';
    } else if (c == '[') {
      inClass = true;
    } else if (c == '(') {
      depth++;
    } else if (c == ')') {
      depth--;
    } else if (c == '|' && depth == 0) {
      found.push_back(source.substr(start, at - start));
      start = at + 1;
    }
  }
  found.push_back(source.substr(start));
  return found;
}

ArgumentRule parseArgument(const std::string &arg) {
  if (hasNul(arg)) {
    throw SpawnRuleError("an argument cannot hold a NUL character");
  }
  static const std::regex placeholder(R"(^\{([A-Za-z_][A-Za-z0-9_]*):([\s\S]+)\}(\.\.\.)?$)");
  std::smatch m;
  if (!std::regex_match(arg, m, placeholder)) {
    return ArgumentRule{.value = arg};
  }
  std::string name = m[1];
  std::string source = m[2];
  bool repeated = m[3].matched;
  ArgumentRule rule{.placeholder = true, .value = name, .repeated = repeated};
  try {
    // On its own first: a pattern that compiles alone has balanced groups, so one such as
    // `a)|(.*` cannot close the anchoring group early and escape it.
    std::regex alone(source, std::regex::ECMAScript);
    rule.pattern = std::regex("^(?:" + source + ")$", std::regex::ECMAScript);
  } catch (const std::regex_error &error) {
    throw SpawnRuleError("{" + name + "} has a pattern that does not compile: " + error.what());
  }
  rule.option = true;
  for (const auto &alternative : topLevelAlternatives(source)) {
    std::string_view rest(alternative);
    if (!rest.empty() && rest[0] == '^') {
      rest.remove_prefix(1);
    }
    if (!rest.empty() && rest[0] == '\\') {
      rest.remove_prefix(1);
    }
    rule.option = rule.option && !rest.empty() && rest[0] == '-';
  }
  return rule;
}

CompiledCapability compileCapability(const SpawnCapability &capability) {
  if (auto problem = programProblem(capability.program)) {
    throw SpawnRuleError(*problem);
  }
  CompiledCapability out{.program = capability.program};
  std::set<std::string> names;
  int repeated = 0;
  for (const auto &arg : capability.args) {
    auto rule = parseArgument(arg);
    if (rule.placeholder) {
      if (!names.insert(rule.value).second) {
        throw SpawnRuleError(capability.program + ": {" + rule.value + "} is declared twice");
      }
      repeated += rule.repeated ? 1 : 0;
    }
    out.args.push_back(std::move(rule));
  }
  if (repeated > 1) {
    throw SpawnRuleError(capability.program + ": at most one placeholder may repeat");
  }
  return out;
}

bool matchArguments(const std::vector<ArgumentRule> &rules, const std::vector<std::string> &args) {
  if (std::any_of(args.begin(), args.end(), hasNul)) {
    return false;
  }
  auto repeatedAt = std::find_if(rules.begin(), rules.end(), [](const auto &r) { return r.placeholder && r.repeated; });
  if (repeatedAt == rules.end()) {
    if (args.size() != rules.size()) {
      return false;
    }
    for (size_t i = 0; i < rules.size(); i++) {
      if (!fits(rules[i], args[i])) {
        return false;
      }
    }
    return true;
  }
  size_t at = static_cast<size_t>(repeatedAt - rules.begin());
  size_t tail = rules.size() - at - 1;
  if (args.size() < at + tail) {
    return false;
  }
  for (size_t i = 0; i < at; i++) {
    if (!fits(rules[i], args[i])) {
      return false;
    }
  }
  size_t tailStart = args.size() - tail;
  for (size_t i = 0; i < tail; i++) {
    if (!fits(rules[at + 1 + i], args[tailStart + i])) {
      return false;
    }
  }
  for (size_t i = at; i < tailStart; i++) {
    if (!passes(*repeatedAt, args[i])) {
      return false;
    }
  }
  return true;
}

std::optional<std::string> matchSpawn(
    const std::vector<CompiledCapability> &capabilities,
    const std::string &program,
    const std::vector<std::string> &args,
    const std::map<std::string, std::optional<std::string>> &resolved) {
  for (const auto &capability : capabilities) {
    std::optional<std::string> pinned;
    if (!capability.program.empty() && capability.program[0] == '/') {
      pinned = capability.program;
    } else if (auto it = resolved.find(capability.program); it != resolved.end()) {
      pinned = it->second;
    }
    if (!pinned) {
      continue;
    }
    if (program != capability.program && program != *pinned) {
      continue;
    }
    if (matchArguments(capability.args, args)) {
      return pinned;
    }
  }
  return std::nullopt;
}

std::optional<std::string> resolveProgram(const std::string &program, const ProgramLookup &lookup) {
  if (programProblem(program)) {
    return std::nullopt;
  }
  std::vector<std::string> candidates;
  if (program[0] == '/') {
    candidates.push_back(program);
  } else {
    for (const auto &dir : kSearchPath) {
      candidates.push_back(dir + "/" + program);
    }
  }
  for (const auto &candidate : candidates) {
    if (!lookup.isExecutable || !lookup.isExecutable(candidate)) {
      continue;
    }
    if (lookup.isStub && lookup.isStub(candidate)) {
      return std::nullopt;
    }
    return candidate;
  }
  return std::nullopt;
}

std::map<std::string, std::string> filterEnvironment(
    const std::map<std::string, std::string> &env,
    const std::vector<std::string> &allowed) {
  std::map<std::string, std::string> out;
  for (const auto &name : allowed) {
    auto it = env.find(name);
    if (it != env.end() && !hasNul(it->second)) {
      out[name] = it->second;
    }
  }
  return out;
}

} // namespace ngn
