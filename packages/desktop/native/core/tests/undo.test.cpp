#include "ngn/undo.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <vector>

namespace {

using Lines = std::vector<std::string>;

// NSUndoManager's rules, as undo.h states them.
struct FakeUndoManager final : ngn::UndoManager {
  struct Action {
    std::string label;
    std::function<void()> run;
  };
  std::vector<Action> undos;
  std::vector<Action> redos;
  bool isUndoing{false};
  bool isRedoing{false};

  void registerAction(const std::string &label, std::function<void()> action) override {
    if (isUndoing) {
      redos.push_back({label, std::move(action)});
    } else {
      undos.push_back({label, std::move(action)});
      if (!isRedoing) {
        redos.clear();
      }
    }
  }
  bool undoing() const override {
    return isUndoing;
  }
  void undo() override {
    if (undos.empty()) {
      return;
    }
    auto action = std::move(undos.back());
    undos.pop_back();
    isUndoing = true;
    action.run();
    isUndoing = false;
  }
  void redo() override {
    if (redos.empty()) {
      return;
    }
    auto action = std::move(redos.back());
    redos.pop_back();
    isRedoing = true;
    action.run();
    isRedoing = false;
  }
  void clear() override {
    undos.clear();
    redos.clear();
  }
  // What Edit > Undo and Edit > Redo would read.
  std::string undoTitle() const {
    return undos.empty() ? "Undo" : "Undo " + undos.back().label;
  }
  std::string redoTitle() const {
    return redos.empty() ? "Redo" : "Redo " + redos.back().label;
  }
};

struct Fixture {
  std::shared_ptr<FakeUndoManager> manager = std::make_shared<FakeUndoManager>();
  std::shared_ptr<ngn::NativeModule> module = ngn::makeUndoModule(manager);
  Lines events;
  Fixture() {
    module->setEmitter([this](const std::string &event, folly::dynamic body) {
      folly::json::serialization_opts opts;
      opts.sort_keys = true;
      events.push_back(event + " " + folly::json::serialize(body, opts));
    });
  }
};

} // namespace

TEST_CASE("an action registered with NgNativeUndo is named in Edit > Undo and sends undo, then redo") {
  Fixture f;
  f.module->call("register", folly::dynamic::array("1", "Rename to b"));
  f.module->call("register", folly::dynamic::array("2", "Rename to c"));
  CHECK(f.manager->undoTitle() == "Undo Rename to c");

  // Edit > Undo, which is the OS's own item over the same manager.
  f.manager->undo();
  CHECK(f.events == Lines{R"(ngNativeUndo {"id":"2","type":"undo"})"});
  CHECK(f.manager->undoTitle() == "Undo Rename to b");
  CHECK(f.manager->redoTitle() == "Redo Rename to c");

  // The module's own redo() and undo().
  f.module->call("redo");
  CHECK(f.events.back() == R"(ngNativeUndo {"id":"2","type":"redo"})");
  CHECK(f.manager->undoTitle() == "Undo Rename to c");
  f.module->call("undo");
  f.module->call("undo");
  CHECK(f.events == Lines{R"(ngNativeUndo {"id":"2","type":"undo"})", R"(ngNativeUndo {"id":"2","type":"redo"})",
                          R"(ngNativeUndo {"id":"2","type":"undo"})", R"(ngNativeUndo {"id":"1","type":"undo"})"});
  // Nothing left to undo: nothing sent.
  f.module->call("undo");
  CHECK(f.events.size() == 4);
}

TEST_CASE("a new action clears the redo history, and clear() empties both") {
  Fixture f;
  f.module->call("register", folly::dynamic::array("1", "Type"));
  f.module->call("undo");
  f.module->call("register", folly::dynamic::array("2", "Paste"));
  CHECK(f.manager->redoTitle() == "Redo");
  f.module->call("clear");
  CHECK(f.manager->undoTitle() == "Undo");
  // A register without a label is ignored.
  f.module->call("register", folly::dynamic::array("3"));
  CHECK(f.manager->undos.empty());
}

TEST_CASE("a reload clears the history, so the old app's actions never reach the new one") {
  Fixture f;
  f.module->call("register", folly::dynamic::array("1", "Rename"));
  f.module.reset();
  CHECK(f.manager->undos.empty());
  auto again = ngn::makeUndoModule(f.manager);
  again->call("register", folly::dynamic::array("1", "Move"));
  CHECK(f.manager->undoTitle() == "Undo Move");
}
