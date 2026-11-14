// A script of input for a dev run to replay into its own window (NGN_INPUT_SCRIPT): what drives the
// host's screens with real toolkit events when no accessibility grant lets anything else post them.
// One step a line, `#` starts a comment, and points are in the window's content, top-left origin:
//
//   wait <ms>
//   move <x> <y>          the pointer, no button down
//   down <x> <y>          the primary button
//   drag <x> <y>
//   up <x> <y>
//   scroll <x> <y> <dx> <dy> [began|changed|ended]   a trackpad scroll by the fingers' movement
//   magnify <x> <y> <amount> began|changed|ended
//   rotate <x> <y> <degrees> began|changed|ended     anticlockwise
//   key <key> [cmd] [shift] [option] [ctrl]          to the key window, whichever it is: a
//                         character, escape or return
#pragma once

#include "ngn/input.h"

#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct InputStep {
  enum class Kind { Wait, Move, Down, Drag, Up, Scroll, Magnify, Rotate, Key } kind;
  enum Modifier : unsigned { Command = 1 << 0, Shift = 1 << 1, Option = 1 << 2, Control = 1 << 3 };
  double x{0};
  double y{0};
  // The wait's milliseconds, a scroll's dx, a magnification or a rotation.
  double amount{0};
  double dy{0};
  std::optional<GesturePhase> phase;
  // A key step's key and modifiers.
  std::string key;
  unsigned modifiers{0};
};

// The steps, or the first bad line's number and why.
struct InputScript {
  std::vector<InputStep> steps;
  std::optional<std::string> error;
};

InputScript parseInputScript(const std::string &text);

} // namespace ngn
