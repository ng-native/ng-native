#include "ngn/input-script.h"

#include <sstream>

namespace ngn {

namespace {

std::optional<GesturePhase> phaseNamed(const std::string &name, bool &ok) {
  ok = true;
  if (name == "began") {
    return GesturePhase::Began;
  }
  if (name == "changed") {
    return GesturePhase::Changed;
  }
  if (name == "ended") {
    return GesturePhase::Ended;
  }
  ok = name.empty();
  return std::nullopt;
}

} // namespace

InputScript parseInputScript(const std::string &text) {
  InputScript script;
  std::istringstream lines(text);
  std::string line;
  int number = 0;
  while (std::getline(lines, line)) {
    ++number;
    if (auto hash = line.find('#'); hash != std::string::npos) {
      line.erase(hash);
    }
    std::istringstream words(line);
    std::string verb;
    if (!(words >> verb)) {
      continue;
    }
    auto fail = [&](const std::string &why) {
      script.steps.clear();
      script.error = "line " + std::to_string(number) + ": " + why;
      return script;
    };
    InputStep step{};
    std::string phase;
    if (verb == "wait") {
      step.kind = InputStep::Kind::Wait;
      if (!(words >> step.amount) || step.amount < 0) {
        return fail("wait needs a number of milliseconds");
      }
    } else if (verb == "move" || verb == "down" || verb == "drag" || verb == "up") {
      step.kind = verb == "move" ? InputStep::Kind::Move
          : verb == "down"       ? InputStep::Kind::Down
          : verb == "drag"       ? InputStep::Kind::Drag
                                 : InputStep::Kind::Up;
      if (!(words >> step.x >> step.y)) {
        return fail(verb + " needs x and y");
      }
    } else if (verb == "scroll") {
      step.kind = InputStep::Kind::Scroll;
      if (!(words >> step.x >> step.y >> step.amount >> step.dy)) {
        return fail("scroll needs x, y, dx and dy");
      }
      words >> phase;
    } else if (verb == "magnify" || verb == "rotate") {
      step.kind = verb == "magnify" ? InputStep::Kind::Magnify : InputStep::Kind::Rotate;
      if (!(words >> step.x >> step.y >> step.amount >> phase) || phase.empty()) {
        return fail(verb + " needs x, y, an amount and a phase");
      }
    } else {
      return fail("unknown step " + verb);
    }
    bool ok = true;
    step.phase = phaseNamed(phase, ok);
    if (!ok) {
      return fail("unknown phase " + phase);
    }
    std::string extra;
    if (words >> extra) {
      return fail("unexpected " + extra);
    }
    script.steps.push_back(step);
  }
  return script;
}

} // namespace ngn
