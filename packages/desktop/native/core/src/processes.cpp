#include "ngn/processes.h"

#include <algorithm>
#include <cctype>
#include <csignal>

namespace ngn {

namespace {

std::vector<std::string> strings(const folly::dynamic &list) {
  std::vector<std::string> out;
  if (!list.isArray()) {
    return out;
  }
  for (const auto &item : list) {
    if (!item.isString()) {
      return {};
    }
    out.push_back(item.asString());
  }
  return out;
}

const folly::dynamic *field(const folly::dynamic &object, const char *name) {
  if (!object.isObject()) {
    return nullptr;
  }
  auto it = object.find(name);
  return it == object.items().end() ? nullptr : &it->second;
}

} // namespace

DeclaredCapabilities parseCapabilities(const folly::dynamic &capabilities) {
  DeclaredCapabilities out;
  if (const auto *spawn = field(capabilities, "spawn"); spawn && spawn->isArray()) {
    for (const auto &entry : *spawn) {
      const auto *program = field(entry, "program");
      const auto *args = field(entry, "args");
      if (program == nullptr || !program->isString() || (args != nullptr && !args->isNull() && !args->isArray())) {
        continue;
      }
      out.spawn.push_back({program->asString(), args ? strings(*args) : std::vector<std::string>{}});
    }
  }
  if (const auto *env = field(capabilities, "env")) {
    out.env = strings(*env);
  }
  if (const auto *paths = field(capabilities, "paths"); paths && paths->isArray()) {
    out.paths = *paths;
  }
  return out;
}

std::optional<int> signalNamed(const std::string &name) {
  if (name == "SIGTERM") {
    return SIGTERM;
  }
  if (name == "SIGINT") {
    return SIGINT;
  }
  if (name == "SIGKILL") {
    return SIGKILL;
  }
  if (name == "SIGHUP") {
    return SIGHUP;
  }
  return std::nullopt;
}

std::shared_ptr<NativeModule> makeProcessesModule(std::shared_ptr<ProcessLauncher> launcher, ProcessesSetup setup) {
  struct Processes : NativeModule {
    std::vector<CompiledCapability> compiled;
    std::map<std::string, std::optional<std::string>> resolved;

    void emitEvent(folly::dynamic body) const {
      emit("ngNativeProcesses", std::move(body));
    }

    Processes(std::shared_ptr<ProcessLauncher> launcher, ProcessesSetup setup) : NativeModule("NgNativeProcesses") {
      if (setup.sandboxed) {
        setup.capabilities.spawn.clear();
        setup.capabilities.paths = folly::dynamic::array();
      }
      folly::dynamic declared = folly::dynamic::array();
      for (const auto &capability : setup.capabilities.spawn) {
        try {
          compiled.push_back(compileCapability(capability));
        } catch (const SpawnRuleError &) {
          // A bad declaration the build should have caught: never allowed.
          continue;
        }
        if (capability.program[0] != '/') {
          resolved[capability.program] = resolveProgram(capability.program, setup.lookup);
        }
        folly::dynamic args = folly::dynamic::array();
        for (const auto &arg : capability.args) {
          args.push_back(arg);
        }
        declared.push_back(folly::dynamic::object("program", capability.program)("args", args));
      }
      auto envNames = setup.capabilities.env;
      auto env = filterEnvironment(setup.environment, envNames);
      constants([declared, envNames, env, resolved = resolved] {
        folly::dynamic envObject = folly::dynamic::object();
        for (const auto &[name, value] : env) {
          envObject[name] = value;
        }
        folly::dynamic names = folly::dynamic::array();
        for (const auto &name : envNames) {
          names.push_back(name);
        }
        folly::dynamic pinned = folly::dynamic::object();
        for (const auto &[name, path] : resolved) {
          pinned[name] = path ? folly::dynamic(*path) : folly::dynamic(nullptr);
        }
        return folly::dynamic::object("env", envObject)("envNames", names)("spawn", declared)("resolved", pinned);
      });

      promise("spawn", [this, launcher, envNames](const folly::dynamic &args, JsPromise promise) {
        if (args.size() < 2 || !args[0].isString() || !args[1].isArray()) {
          promise.reject("spawn takes a program and a list of arguments");
          return;
        }
        std::string program = args[0].asString();
        std::vector<std::string> argv;
        for (const auto &arg : args[1]) {
          if (!arg.isString()) {
            promise.reject("every argument must be a string");
            return;
          }
          argv.push_back(arg.asString());
        }
        auto path = matchSpawn(compiled, program, argv, resolved);
        if (!path) {
          promise.reject(program + " with these arguments matches no spawn capability in the app's declaration");
          return;
        }
        std::optional<std::string> cwd;
        if (args.size() > 2 && args[2].isString()) {
          cwd = args[2].asString();
          if (!plainPath(*cwd)) {
            promise.reject("the working directory must be an absolute, normalized path");
            return;
          }
        }
        std::map<std::string, std::string> given;
        if (args.size() > 3 && args[3].isObject()) {
          for (const auto &[key, value] : args[3].items()) {
            if (key.isString() && value.isString()) {
              given[key.asString()] = value.asString();
            }
          }
        }
        auto started = launcher->spawn(*path, argv, cwd, filterEnvironment(given, envNames));
        if (const auto *handle = std::get_if<int>(&started)) {
          promise.resolve(*handle);
        } else {
          promise.reject(std::get<std::string>(started));
        }
      });
      async("write", [launcher](const folly::dynamic &args, std::vector<JsCallback>) {
        if (args.size() > 1 && args[0].isNumber() && args[1].isString()) {
          launcher->write(static_cast<int>(args[0].asInt()), args[1].asString());
        }
      });
      async("closeStdin", [launcher](const folly::dynamic &args, std::vector<JsCallback>) {
        if (args.size() > 0 && args[0].isNumber()) {
          launcher->closeStdin(static_cast<int>(args[0].asInt()));
        }
      });
      async("kill", [launcher](const folly::dynamic &args, std::vector<JsCallback>) {
        auto signal = args.size() > 1 && args[1].isString() ? signalNamed(args[1].asString()) : std::optional<int>(SIGTERM);
        if (args.size() > 0 && args[0].isNumber() && signal) {
          launcher->kill(static_cast<int>(args[0].asInt()), *signal);
        }
      });
      listeners();
    }
  };
  auto module = std::make_shared<Processes>(launcher, std::move(setup));
  std::weak_ptr<Processes> weak = module;
  // A reload's module hears only the programs it spawned: the JavaScript holds an event for a
  // handle spawn() has not answered yet, and would hold an older runtime's events forever.
  int floor = launcher->lastHandle();
  launcher->setEvents({
      .output =
          [weak, floor](int handle, bool isStderr, std::string data) {
            if (auto self = weak.lock(); self && handle > floor) {
              self->emitEvent(folly::dynamic::object("type", isStderr ? "stderr" : "stdout")("handle", handle)("data", data));
            }
          },
      .exit =
          [weak, floor](int handle, std::optional<int> code, std::optional<std::string> signal) {
            if (auto self = weak.lock(); self && handle > floor) {
              self->emitEvent(folly::dynamic::object("type", "exit")("handle", handle)(
                  "code", code ? folly::dynamic(*code) : folly::dynamic(nullptr))(
                  "signal", signal ? folly::dynamic(*signal) : folly::dynamic(nullptr)));
            }
          },
  });
  return module;
}

bool externalUrlAllowed(const std::string &url) {
  auto colon = url.find(':');
  if (colon == std::string::npos || colon == 0 || url.find('\0') != std::string::npos) {
    return false;
  }
  std::string scheme = url.substr(0, colon);
  if (!std::isalpha(static_cast<unsigned char>(scheme[0])) ||
      !std::all_of(scheme.begin(), scheme.end(), [](unsigned char c) { return std::isalnum(c) || c == '+' || c == '-' || c == '.'; })) {
    return false;
  }
  std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](unsigned char c) { return std::tolower(c); });
  return scheme != "file" && scheme != "javascript" && scheme != "data" && scheme != "vbscript" && scheme != "blob";
}

bool plainPath(const std::string &path) {
  if (path.empty() || path[0] != '/' || path.find('\0') != std::string::npos) {
    return false;
  }
  if (path == "/") {
    return true;
  }
  size_t start = 1;
  while (start <= path.size()) {
    auto slash = path.find('/', start);
    auto segment = path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
    if (segment.empty() || segment == "." || segment == "..") {
      return false;
    }
    if (slash == std::string::npos) {
      break;
    }
    start = slash + 1;
  }
  return true;
}

std::shared_ptr<NativeModule> makeShellModule(std::shared_ptr<ShellOpener> opener) {
  struct Shell : NativeModule {
    explicit Shell(std::shared_ptr<ShellOpener> opener) : NativeModule("NgNativeShell") {
      auto answer = [](JsPromise promise) { return [promise](bool done) { promise.resolve(done); }; };
      promise("openExternal", [opener, answer](const folly::dynamic &args, JsPromise promise) {
        if (args.size() < 1 || !args[0].isString() || !externalUrlAllowed(args[0].asString())) {
          promise.resolve(false);
          return;
        }
        opener->openUrl(args[0].asString(), answer(promise));
      });
      promise("openPath", [opener, answer](const folly::dynamic &args, JsPromise promise) {
        if (args.size() < 1 || !args[0].isString() || !plainPath(args[0].asString())) {
          promise.resolve(false);
          return;
        }
        // A document opens in its app; a program, an app or a script would run, past the spawn
        // rules.
        auto facts = opener->facts(args[0].asString());
        if (!facts.exists || facts.executable || facts.runsCode) {
          promise.resolve(false);
          return;
        }
        opener->openPath(args[0].asString(), answer(promise));
      });
      promise("showItemInFolder", [opener, answer](const folly::dynamic &args, JsPromise promise) {
        if (args.size() < 1 || !args[0].isString() || !plainPath(args[0].asString())) {
          promise.resolve(false);
          return;
        }
        opener->showItemInFolder(args[0].asString(), answer(promise));
      });
    }
  };
  return std::make_shared<Shell>(std::move(opener));
}

} // namespace ngn
