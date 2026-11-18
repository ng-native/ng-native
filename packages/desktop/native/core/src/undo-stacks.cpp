#include "ngn/undo.h"

namespace ngn {

namespace {

// Sets a flag for one action's run and clears it however the run ends, so an action that throws
// does not leave later registrations going to the wrong stack.
struct Running {
  bool &flag;
  explicit Running(bool &flag) : flag(flag) {
    flag = true;
  }
  ~Running() {
    flag = false;
  }
};

} // namespace

void UndoStacks::registerAction(const std::string &label, std::function<void()> action) {
  if (undoing_) {
    redos_.push_back({label, std::move(action)});
    return;
  }
  undos_.push_back({label, std::move(action)});
  if (!redoing_) {
    redos_.clear();
  }
}

bool UndoStacks::undoing() const {
  return undoing_;
}

void UndoStacks::undo() {
  if (undos_.empty()) {
    return;
  }
  auto action = std::move(undos_.back());
  undos_.pop_back();
  Running running(undoing_);
  action.run();
}

void UndoStacks::redo() {
  if (redos_.empty()) {
    return;
  }
  auto action = std::move(redos_.back());
  redos_.pop_back();
  Running running(redoing_);
  action.run();
}

void UndoStacks::clear() {
  undos_.clear();
  redos_.clear();
}

std::optional<std::string> UndoStacks::undoLabel() const {
  return undos_.empty() ? std::nullopt : std::optional(undos_.back().label);
}

std::optional<std::string> UndoStacks::redoLabel() const {
  return redos_.empty() ? std::nullopt : std::optional(redos_.back().label);
}

} // namespace ngn
