// The OS the desktop host runs on, as the core needs to know it: the values that differ from one
// desktop OS to the next. A backend passes its OS's in as it builds the host, so the core itself
// names none of them.
#pragma once

#include <string>
#include <vector>

namespace ngn {

struct MenuItem;
struct DefaultMenuOptions;

// A key press: the key as the web names it (a character, or "ArrowLeft", "Enter", "F5"...) and the
// modifiers held (MenuModifier, default-menu.h).
struct KeyChord {
  std::string key;
  unsigned modifiers{0};
  bool operator==(const KeyChord &) const = default;
};

struct HostOs {
  // What `Platform.OS` reports ("macos"): the Metro `platform` a bundle URL without one is for, the
  // `expo-platform` header Expo Updates sends by default, and a device push token's `type`.
  std::string id;
  // What Device's `osName` reports ("macOS").
  std::string name;
  // Device's brand and manufacturer where the OS's maker makes the machines it runs on ("Apple");
  // empty where the machine's own maker is (MachineFacts::manufacturer).
  std::string deviceMaker;
  // The host binary's name, for its usage line.
  std::string program;
  // The modifier an app's shortcuts and the OS's own commands use (MenuModifier): the one a
  // `mod+` shortcut means, and the one that makes Z, X, C, V and A a focused text input's.
  unsigned primaryModifier{0};
  // The key presses that go back and forward through a window's history.
  KeyChord back;
  KeyChord forward;
  // Where a bare program name a spawn capability declares is looked for, in order.
  std::vector<std::string> searchPath;
  // The menu bar an app has before its own (default-menu.h). It has a Close Window item, and with
  // `options.developer` a menu holding Reload: an app's bar takes both from it (parseMenuBar).
  std::vector<MenuItem> (*menuBar)(const DefaultMenuOptions &options){nullptr};
};

HostOs macOS();
// Linux, under GTK. Not `linux()`: GNU C++ predefines `linux` as a macro on Linux.
HostOs linuxOs();

} // namespace ngn
