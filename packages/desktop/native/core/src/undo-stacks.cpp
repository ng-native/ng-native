#include "ngn/undo.h"

namespace ngn {

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
  undoing_ = true;
  action.run();
  undoing_ = false;
}

void UndoStacks::redo() {
  if (redos_.empty()) {
    return;
  }
  auto action = std::move(redos_.back());
  redos_.pop_back();
  redoing_ = true;
  action.run();
  redoing_ = false;
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
