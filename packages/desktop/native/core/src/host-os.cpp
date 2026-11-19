#include "ngn/host-os.h"

#include "ngn/default-menu.h"

namespace ngn {

HostOs macOS() {
  return {
      .id = "macos",
      .name = "macOS",
      .program = "ngn-macos",
      .primaryModifier = Command,
      .back = {.key = "[", .modifiers = Command},
      .forward = {.key = "]", .modifiers = Command},
      .searchPath = {"/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"},
      .menuBar = macOSMenuBar,
  };
}

} // namespace ngn
