#include "ngn/undo.h"

namespace ngn {

namespace {

struct Undo : NativeModule {
  explicit Undo(std::shared_ptr<UndoManager> manager) : NativeModule("NgNativeUndo"), manager_(std::move(manager)) {
    sync("register", [this](const folly::dynamic &args) {
      if (args.size() >= 2 && args[0].isString() && args[1].isString()) {
        add(args[0].asString(), args[1].asString());
      }
      return folly::dynamic(nullptr);
    });
    sync("undo", [this](const folly::dynamic &) {
      manager_->undo();
      return folly::dynamic(nullptr);
    });
    sync("redo", [this](const folly::dynamic &) {
      manager_->redo();
      return folly::dynamic(nullptr);
    });
    sync("clear", [this](const folly::dynamic &) {
      manager_->clear();
      return folly::dynamic(nullptr);
    });
    listeners();
  }

  ~Undo() override {
    // The actions run into this module: a reloaded app gets a clean history.
    *alive_ = false;
    manager_->clear();
  }

  void add(const std::string &id, const std::string &label) {
    std::weak_ptr<bool> alive = alive_;
    manager_->registerAction(label, [this, alive, id, label] {
      auto live = alive.lock();
      if (!live || !*live) {
        return;
      }
      emit("ngNativeUndo", folly::dynamic::object("type", manager_->undoing() ? "undo" : "redo")("id", id));
      // Its inverse, on the other stack.
      add(id, label);
    });
  }

  std::shared_ptr<UndoManager> manager_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};

} // namespace

std::shared_ptr<NativeModule> makeUndoModule(std::shared_ptr<UndoManager> manager) {
  return std::make_shared<Undo>(std::move(manager));
}

} // namespace ngn
