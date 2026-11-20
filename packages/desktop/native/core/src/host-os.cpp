#include "ngn/host-os.h"

#include "ngn/default-menu.h"

namespace ngn {

HostOs macOS() {
  return {
      .id = "macos",
      .name = "macOS",
      .deviceMaker = "Apple",
      .program = "ngn-macos",
      .primaryModifier = Command,
      .back = {.key = "[", .modifiers = Command},
      .forward = {.key = "]", .modifiers = Command},
      .searchPath = {"/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"},
      .menuBar = macOSMenuBar,
  };
}

// Ctrl for an app's shortcuts and the OS's own; Alt+Left and Alt+Right for back and forward, as
// GNOME's and KDE's apps have them, the other way round in a right-to-left locale, where back
// points right; no Homebrew on the search path.
HostOs linuxOs(bool rightToLeft) {
  const char *back = rightToLeft ? "ArrowRight" : "ArrowLeft";
  const char *forward = rightToLeft ? "ArrowLeft" : "ArrowRight";
  return {
      .id = "linux",
      .name = "Linux",
      .program = "ngn-linux",
      .primaryModifier = Control,
      .back = {.key = back, .modifiers = Option},
      .forward = {.key = forward, .modifiers = Option},
      .searchPath = {"/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin"},
      .menuBar = linuxMenuBar,
  };
}

} // namespace ngn
