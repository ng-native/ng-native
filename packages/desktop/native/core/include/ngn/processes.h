// `NgNativeProcesses` and `NgNativeShell`: the app's environment, the programs it declared, and
// handing a url or a file to the OS (@ng-native/device's processes.ts and shell.ts).
//
// The core enforces the capabilities itself, from the plugin options baked into the app: a spawn
// runs only when a declared capability allows the program and its arguments (spawn-rules.h), never
// through a shell, with only the declared environment variables. The JavaScript checks first for a
// clear error; this is the boundary. In a sandboxed (Mac App Store) build nothing may be spawned.
//
// The OS is reached through narrow interfaces: ProcessLauncher (posix_spawn with pipes, in
// makePosixLauncher) and ShellOpener (NSWorkspace on macOS).
#pragma once

#include "ngn/native-module.h"
#include "ngn/spawn-rules.h"

#include <folly/dynamic.h>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace ngn {

// The `capabilities` of the @ng-native/desktop plugin options.
struct DeclaredCapabilities {
  std::vector<SpawnCapability> spawn;
  std::vector<std::string> env;
  folly::dynamic paths = folly::dynamic::array();
};

// Reads the options' `capabilities` as the bin bakes them (Info.plist's NGNCapabilities, or the
// dev command's argument). Anything malformed is left out: a capability not understood is not had.
DeclaredCapabilities parseCapabilities(const folly::dynamic &capabilities);

class ProcessLauncher {
 public:
  struct Events {
    // What a program wrote, as it arrives. Any thread.
    std::function<void(int handle, bool isStderr, std::string data)> output;
    // Once its output is all reported: its exit code, or the signal that stopped it.
    std::function<void(int handle, std::optional<int> code, std::optional<std::string> signal)> exit;
  };
  virtual ~ProcessLauncher() = default;
  virtual void setEvents(Events events) = 0;
  // A handle, or why it did not start. `env` is the whole environment the program gets.
  virtual std::variant<int, std::string> spawn(
      const std::string &path,
      const std::vector<std::string> &args,
      const std::optional<std::string> &cwd,
      const std::map<std::string, std::string> &env) = 0;
  virtual void write(int handle, const std::string &data) = 0;
  virtual void closeStdin(int handle) = 0;
  virtual void kill(int handle, int signal) = 0;
  // The last handle spawn gave out, or 0. Handles only grow and are never reused.
  virtual int lastHandle() const = 0;
};

// posix_spawn with a pipe for each standard stream, read on threads of their own.
std::shared_ptr<ProcessLauncher> makePosixLauncher();

struct ProcessesSetup {
  DeclaredCapabilities capabilities;
  // The environment the app was started with.
  std::map<std::string, std::string> environment;
  ProgramLookup lookup;
  // A Mac App Store build: no program outside the app may run.
  bool sandboxed{false};
};

std::shared_ptr<NativeModule> makeProcessesModule(std::shared_ptr<ProcessLauncher> launcher, ProcessesSetup setup);

// The signal a name the module takes stands for, or nothing for one it does not.
std::optional<int> signalNamed(const std::string &name);

class ShellOpener {
 public:
  // What is at a path, as far as opening it goes.
  struct PathFacts {
    bool exists{false};
    // A regular file with an execute bit.
    bool executable{false};
    // Opening it runs code: an app, a script or a Terminal command file, an installer package, a
    // workflow, or a location file that points at one of those.
    bool runsCode{false};
  };
  virtual ~ShellOpener() = default;
  virtual PathFacts facts(const std::string &path) = 0;
  virtual void openUrl(const std::string &url, std::function<void(bool)> done) = 0;
  virtual void openPath(const std::string &path, std::function<void(bool)> done) = 0;
  virtual void showItemInFolder(const std::string &path, std::function<void(bool)> done) = 0;
};

// Whether `openExternal`, and Linking's openURL, hand this url on: one with a scheme, but not a
// file (openPath's, which checks what the file is), and none that runs or embeds content.
bool externalUrlAllowed(const std::string &url);
// Whether `path` is absolute and normalized, with nothing to walk out of where it says.
bool plainPath(const std::string &path);

std::shared_ptr<NativeModule> makeShellModule(std::shared_ptr<ShellOpener> opener);

} // namespace ngn
