// The macOS side of NgNativeProcesses and NgNativeShell (the core's processes.h): where the
// capabilities come from, how a program is found, and NSWorkspace for Shell.
#pragma once

#import <Foundation/Foundation.h>

#include "ngn/processes.h"

#include <folly/dynamic.h>
#include <memory>
#include <optional>

namespace ngn::appkit {

// A property list value as JSON-shaped data.
folly::dynamic dynamicFrom(id value);

// What a packaged app's Info.plist bakes in (the bin's package.mjs), or nothing for a host run from
// the dev command.
struct PackagedApp {
  std::string bundlePath;
  std::string moduleName;
  std::string distribution;
};
std::optional<PackagedApp> packagedApp();

// The capabilities and environment Processes runs with: Info.plist's NGNCapabilities in a packaged
// app, otherwise `capabilitiesJson` (the dev command's --capabilities), otherwise none. A `mas`
// distribution is sandboxed.
ProcessesSetup processesSetup(const std::string &capabilitiesJson);

std::shared_ptr<ShellOpener> makeShellOpener();

} // namespace ngn::appkit
