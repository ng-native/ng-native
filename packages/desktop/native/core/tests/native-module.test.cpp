#include "ngn/native-module.h"

#include <doctest/doctest.h>

namespace {

struct Echo final : ngn::NativeModule {
  Echo() : NativeModule("Echo") {
    constants([] { return folly::dynamic::object("answer", 42); });
    sync("twice", [](const folly::dynamic &args) { return args[0].asInt() * 2; });
    async("later", [this](const folly::dynamic &args, std::vector<ngn::JsCallback> callbacks) {
      emit("echoed", args[0]);
      callbacks.at(0)(folly::dynamic::array(nullptr, args[0]));
    });
    promise("upper", [](const folly::dynamic &args, ngn::JsPromise p) {
      if (args[0].asString().empty()) {
        p.reject("empty");
      } else {
        p.resolve(args[0].asString() + "!");
      }
    });
    listeners();
  }
};

} // namespace

TEST_CASE("a core module answers sync, callback and promise calls without a JavaScript engine") {
  Echo echo;
  CHECK(echo.call("getConstants")["answer"] == 42);
  CHECK(echo.call("twice", folly::dynamic::array(21)) == 42);

  std::vector<std::string> events;
  echo.setEmitter([&](const std::string &event, folly::dynamic body) { events.push_back(event + " " + body.asString()); });
  folly::dynamic got;
  echo.callWithCallbacks("later", folly::dynamic::array("hi", nullptr), {[&](folly::dynamic args) { got = args; }});
  CHECK(got == folly::dynamic::array(nullptr, "hi"));
  CHECK(events == std::vector<std::string>{"echoed hi"});

  std::string resolved, rejected;
  echo.callWithPromise("upper", folly::dynamic::array("a"), ngn::JsPromise{[&](folly::dynamic v) { resolved = v.asString(); }, nullptr});
  echo.callWithPromise("upper", folly::dynamic::array(""), ngn::JsPromise{nullptr, [&](const std::string &m) { rejected = m; }});
  CHECK(resolved == "a!");
  CHECK(rejected == "empty");

  CHECK(echo.methods().count("addListener") == 1);
  CHECK(echo.methods().count("removeListeners") == 1);
}

TEST_CASE("a module with no emitter drops its events") {
  Echo echo;
  bool called = false;
  echo.callWithCallbacks("later", folly::dynamic::array("x"), {[&](folly::dynamic) { called = true; }});
  CHECK(called);
}
