// NgNativeUndo over the core's own undo stacks (undo.h).
#include "ngn/undo.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <vector>

namespace {

using Lines = std::vector<std::string>;

// What Edit > Undo and Edit > Redo would read.
std::string undoTitle(const ngn::UndoStacks &stacks) {
  auto label = stacks.undoLabel();
  return label ? "Undo " + *label : "Undo";
}
std::string redoTitle(const ngn::UndoStacks &stacks) {
  auto label = stacks.redoLabel();
  return label ? "Redo " + *label : "Redo";
}

struct Fixture {
  std::shared_ptr<ngn::UndoStacks> manager = std::make_shared<ngn::UndoStacks>();
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
  CHECK(undoTitle(*f.manager) == "Undo Rename to c");

  // Edit > Undo, which is the OS's own item over the same manager.
  f.manager->undo();
  CHECK(f.events == Lines{R"(ngNativeUndo {"id":"2","type":"undo"})"});
  CHECK(undoTitle(*f.manager) == "Undo Rename to b");
  CHECK(redoTitle(*f.manager) == "Redo Rename to c");

  // The module's own redo() and undo().
  f.module->call("redo");
  CHECK(f.events.back() == R"(ngNativeUndo {"id":"2","type":"redo"})");
  CHECK(undoTitle(*f.manager) == "Undo Rename to c");
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
  CHECK(redoTitle(*f.manager) == "Redo");
  f.module->call("register", folly::dynamic::array("3", "Cut"));
  f.module->call("undo");
  CHECK(redoTitle(*f.manager) == "Redo Cut");
  f.module->call("clear");
  CHECK(undoTitle(*f.manager) == "Undo");
  CHECK(redoTitle(*f.manager) == "Redo");
  // A register without a label is ignored.
  f.module->call("register", folly::dynamic::array("3"));
  CHECK_FALSE(f.manager->undoLabel());
}

TEST_CASE("a reload clears the history, so the old app's actions never reach the new one") {
  Fixture f;
  f.module->call("register", folly::dynamic::array("1", "Rename"));
  f.module.reset();
  CHECK_FALSE(f.manager->undoLabel());
  auto again = ngn::makeUndoModule(f.manager);
  again->call("register", folly::dynamic::array("1", "Move"));
  CHECK(undoTitle(*f.manager) == "Undo Move");
}

TEST_CASE("redoing one of several undone actions keeps the rest to redo") {
  Fixture f;
  f.module->call("register", folly::dynamic::array("1", "Rename to b"));
  f.module->call("register", folly::dynamic::array("2", "Rename to c"));
  f.module->call("undo");
  f.module->call("undo");
  CHECK(redoTitle(*f.manager) == "Redo Rename to b");
  f.module->call("redo");
  CHECK(undoTitle(*f.manager) == "Undo Rename to b");
  CHECK(redoTitle(*f.manager) == "Redo Rename to c");
  CHECK_FALSE(f.manager->undoing());
}
