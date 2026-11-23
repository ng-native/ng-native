#include "fake-network.h"
#include "ngn/red-box.h"

#include <doctest/doctest.h>
#include <folly/json.h>

using folly::dynamic;
using ngn::JsError;
using ngn::JsStackFrame;

namespace {

struct Recorder final : ngn::RedBoxBackend {
  std::vector<ngn::RedBoxContent> shown;
  int hides{0};
  void show(const ngn::RedBoxContent &content) override {
    shown.push_back(content);
  }
  void hide() override {
    ++hides;
  }
};

struct Fixture {
  std::shared_ptr<Recorder> backend = std::make_shared<Recorder>();
  std::shared_ptr<ngn::testing::FakeHttp> http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::RedBox box{backend, http, "http://localhost:8091"};
};

JsError error(const std::string &message, bool fatal = false) {
  JsError e;
  e.message = message;
  e.fatal = fatal;
  e.stack = {{.methodName = "save", .file = "http://localhost:8091/index.bundle?platform=macos&dev=true", .line = 120, .column = 7}};
  return e;
}

void answer(ngn::testing::FakeHttp::Sent &sent, const std::string &body) {
  sent.callbacks.onResponse(ngn::HttpResponse{.status = 200});
  sent.callbacks.onData(body, -1);
  sent.callbacks.onComplete("", false);
}

} // namespace

TEST_CASE("the pipeline's error becomes the box's") {
  auto data = folly::parseJson(R"({
    "message": "Cannot read property 'x' of undefined",
    "originalMessage": "Cannot read property 'x' of undefined",
    "componentStack": "",
    "isFatal": true,
    "id": 3,
    "stack": [
      {"methodName": "save", "file": "http://localhost:8091/index.bundle?platform=macos", "lineNumber": 120, "column": 7},
      {"methodName": "global code", "file": null, "lineNumber": null, "column": null}
    ]
  })");
  auto e = ngn::jsErrorFrom(data);
  REQUIRE(e);
  CHECK(e->message == "Cannot read property 'x' of undefined");
  CHECK(e->fatal);
  REQUIRE(e->stack.size() == 2);
  CHECK(e->stack[0].methodName == "save");
  CHECK(e->stack[0].line == 120);
  CHECK(e->stack[0].column == 7);
  CHECK(e->stack[1].file.empty());
  CHECK(e->stack[1].line == -1);

  CHECK_FALSE(ngn::jsErrorFrom(dynamic::object("isFatal", false)));
  CHECK_FALSE(ngn::jsErrorFrom(dynamic("text")));
}

TEST_CASE("a frame is listed by its file's name, line and column") {
  CHECK(ngn::frameLocation({.methodName = "save", .file = "http://localhost:8091/index.bundle?platform=macos&dev=true", .line = 12, .column = 4}) ==
        "index.bundle:12:4");
  CHECK(ngn::frameLocation({.methodName = "save", .file = "/Users/me/app/src/app/notes.ts", .line = 3, .column = 9}) == "notes.ts:3:9");
  CHECK(ngn::frameLocation({.methodName = "save", .file = "", .line = -1, .column = -1}).empty());
  CHECK(ngn::frameLocation({.methodName = "save", .file = "native", .line = -1, .column = -1}) == "native");
}

TEST_CASE("collapsed frames are left out unless every frame is") {
  JsError e;
  e.stack = {{.methodName = "a", .collapse = true}, {.methodName = "b"}, {.methodName = "c", .collapse = true}};
  auto shown = ngn::shownFrames(e);
  REQUIRE(shown.size() == 1);
  CHECK(shown[0].methodName == "b");
  e.stack[1].collapse = true;
  CHECK(ngn::shownFrames(e).size() == 3);
}

TEST_CASE("a soft error and a fatal one both show, newest first, and dismiss clears them") {
  Fixture f;
  CHECK_FALSE(f.box.showing());
  f.box.report(error("first"));
  REQUIRE(f.backend->shown.size() == 1);
  CHECK(f.box.showing());
  CHECK(f.backend->shown.back().error.message == "first");
  CHECK(f.backend->shown.back().count == 1);

  f.box.report(error("second", true));
  CHECK(f.backend->shown.back().error.message == "second");
  CHECK(f.backend->shown.back().error.fatal);
  CHECK(f.backend->shown.back().index == 1);
  CHECK(f.backend->shown.back().count == 2);

  f.box.step(-1);
  CHECK(f.backend->shown.back().error.message == "first");
  CHECK(f.backend->shown.back().index == 0);
  // Past either end it stays.
  f.box.step(-1);
  CHECK(f.backend->shown.back().index == 0);

  f.box.dismiss();
  CHECK(f.backend->hides == 1);
  CHECK_FALSE(f.box.showing());
  CHECK(f.box.count() == 0);

  // The next error shows the box again, alone.
  f.box.report(error("third"));
  CHECK(f.box.showing());
  CHECK(f.backend->shown.back().count == 1);
}

TEST_CASE("the same error reported twice in a row is kept once") {
  Fixture f;
  f.box.report(error("twice"));
  f.box.report(error("twice"));
  CHECK(f.box.count() == 1);
  f.box.report(error("other"));
  f.box.report(error("twice"));
  CHECK(f.box.count() == 3);
}

TEST_CASE("a reload clears the box and hides it") {
  Fixture f;
  f.box.reloaded();
  // Nothing was showing: nothing to hide.
  CHECK(f.backend->hides == 0);
  f.box.report(error("before the reload"));
  f.box.reloaded();
  CHECK(f.backend->hides == 1);
  CHECK(f.box.count() == 0);
  CHECK_FALSE(f.box.showing());
}

TEST_CASE("the stack is symbolicated by the dev server") {
  Fixture f;
  f.box.report(error("boom"));
  REQUIRE(f.http->sent.size() == 1);
  auto &sent = *f.http->sent[0];
  CHECK(sent.request.method == "POST");
  CHECK(sent.request.url == "http://localhost:8091/symbolicate");
  auto body = folly::parseJson(sent.request.body);
  CHECK(body["stack"][0]["methodName"] == "save");
  CHECK(body["stack"][0]["lineNumber"] == 120);
  CHECK(body["stack"][0]["column"] == 7);

  answer(sent, R"({"stack": [
    {"methodName": "NoteEditor.save", "file": "/app/src/app/notes/note-editor.ts", "lineNumber": 41, "column": 12, "collapse": false}
  ]})");
  REQUIRE(f.backend->shown.size() == 2);
  const auto &frame = f.backend->shown.back().error.stack.at(0);
  CHECK(frame.methodName == "NoteEditor.save");
  CHECK(ngn::frameLocation(frame) == "note-editor.ts:41:12");
}

TEST_CASE("a symbolication that answers after a dismiss is dropped") {
  Fixture f;
  f.box.report(error("before the dismiss"));
  f.box.dismiss();
  // A new first error takes the place the old one's answer is for.
  f.box.report(error("after the dismiss"));
  REQUIRE(f.http->sent.size() == 2);
  auto shownBefore = f.backend->shown.size();
  answer(*f.http->sent[0], R"({"stack": [{"methodName": "stale", "file": "/a.ts", "lineNumber": 1, "column": 1}]})");
  CHECK(f.backend->shown.size() == shownBefore);
  CHECK(f.backend->shown.back().error.stack.at(0).methodName == "save");
}

TEST_CASE("a failed symbolication keeps the stack as it was") {
  Fixture f;
  f.box.report(error("boom"));
  REQUIRE(f.http->sent.size() == 1);
  f.http->sent[0]->callbacks.onComplete("offline", false);
  CHECK(f.backend->shown.size() == 1);
  f.box.report(error("again"));
  REQUIRE(f.http->sent.size() == 2);
  answer(*f.http->sent[1], "not json");
  CHECK(f.backend->shown.back().error.stack.at(0).methodName == "save");
}

TEST_CASE("without a dev server nothing is symbolicated") {
  auto backend = std::make_shared<Recorder>();
  auto http = std::make_shared<ngn::testing::FakeHttp>();
  ngn::RedBox box{backend, http, ""};
  box.report(error("boom"));
  CHECK(http->sent.empty());
  CHECK(backend->shown.size() == 1);
}

TEST_CASE("a Hermes stack string becomes frames") {
  auto frames = ngn::parseJsStack(
      "Error: Soft error from a press handler\n"
      "    at throwInHandler (http://localhost:8091/src/app/error-fixture.bundle?platform=macos:12:20)\n"
      "    at anonymous (http://localhost:8091/index.bundle?platform=macos:3:5)\n"
      "    at apply (native)\n"
      "    at http://localhost:8091/index.bundle?platform=macos:40:2\n"
      "    at loop (address at http://localhost:8091/index.bundle:1:234)\n");
  REQUIRE(frames.size() == 5);
  CHECK(frames[0].methodName == "throwInHandler");
  CHECK(frames[0].file == "http://localhost:8091/src/app/error-fixture.bundle?platform=macos");
  CHECK(frames[0].line == 12);
  CHECK(frames[0].column == 20);
  CHECK(frames[2].methodName == "apply");
  CHECK(frames[2].file == "native");
  CHECK(frames[2].line == -1);
  CHECK(frames[3].methodName.empty());
  CHECK(frames[3].line == 40);
  CHECK(frames[4].file == "http://localhost:8091/index.bundle");
  CHECK(frames[4].column == 234);
  CHECK(ngn::parseJsStack("no frames here").empty());
}

TEST_CASE("an error the console or ErrorUtils hands over becomes the box's") {
  auto e = ngn::jsErrorFromConsole(folly::parseJson(R"json({
    "message": "ERROR Error: boom",
    "stack": "Error: boom\n    at save (http://localhost:8091/index.bundle:9:3)",
    "isFatal": false
  })json"));
  REQUIRE(e);
  CHECK(e->message == "ERROR Error: boom");
  CHECK_FALSE(e->fatal);
  REQUIRE(e->stack.size() == 1);
  CHECK(e->stack[0].methodName == "save");
  CHECK_FALSE(ngn::jsErrorFromConsole(folly::parseJson(R"({"message": "", "stack": ""})")));
}

TEST_CASE("the same message again is one error, made fatal or given a stack by the later report") {
  Fixture f;
  // React Native's pipeline logs an error before the runtime is ready with console.error (no
  // stack), then hands it to its listeners as fatal, with the stack.
  JsError logged;
  logged.message = "[runtime not ready]: boom";
  f.box.report(logged);
  JsError piped = logged;
  piped.fatal = true;
  piped.stack = {{.methodName = "main", .file = "/index.bundle", .line = 1, .column = 2}};
  f.box.report(piped);
  CHECK(f.box.count() == 1);
  CHECK(f.backend->shown.back().error.fatal);
  CHECK(f.backend->shown.back().error.stack.size() == 1);
  // A later soft report of it keeps it fatal and its stack.
  f.box.report(logged);
  CHECK(f.box.count() == 1);
  CHECK(f.backend->shown.back().error.fatal);
  CHECK(f.backend->shown.back().error.stack.size() == 1);
}

TEST_CASE("a symbolication answers the error it was asked for after older errors make way") {
  Fixture f;
  // The box keeps 50: the 51st pushes the first out, and every later one moves down a place.
  for (int i = 0; i <= 50; i++) {
    f.box.report(error("error " + std::to_string(i)));
  }
  REQUIRE(f.http->sent.size() == 51);
  answer(*f.http->sent[1], R"({"stack": [{"methodName": "forError1", "file": "/a.ts", "lineNumber": 1, "column": 1}]})");
  // Error 1 is the first kept now; stepping to it shows its own stack, and error 2 keeps its own.
  f.box.step(-100);
  CHECK(f.backend->shown.back().error.message == "error 1");
  CHECK(f.backend->shown.back().error.stack.at(0).methodName == "forError1");
  f.box.step(1);
  CHECK(f.backend->shown.back().error.message == "error 2");
  CHECK(f.backend->shown.back().error.stack.at(0).methodName == "save");
  // The first error's answer has nothing left to apply to.
  answer(*f.http->sent[0], R"({"stack": [{"methodName": "forError0", "file": "/a.ts", "lineNumber": 1, "column": 1}]})");
  f.box.step(-1);
  CHECK(f.backend->shown.back().error.stack.at(0).methodName == "forError1");
}

TEST_CASE("a fatal error keeps the box while the errors that follow from it are kept behind it") {
  Fixture f;
  // A module that throws as the bundle loads, then AppRegistry finding no app because of it.
  f.box.report(error("TypeError: undefined cannot be used as a constructor", true));
  f.box.report(error("soft"));
  f.box.report(error("Invariant Violation: \"main\" has not been registered", true));
  CHECK(f.box.count() == 3);
  CHECK(f.backend->shown.back().error.message == "TypeError: undefined cannot be used as a constructor");
  CHECK(f.backend->shown.back().index == 0);
  CHECK(f.backend->shown.back().count == 3);
  // Stepped away from it, the next error shows as it comes.
  f.box.step(1);
  CHECK(f.backend->shown.back().error.message == "soft");
  f.box.report(error("later"));
  CHECK(f.backend->shown.back().error.message == "later");
}

TEST_CASE("a fatal error on show stays on show as the oldest error makes way") {
  Fixture f;
  // The box keeps 50: the 51st pushes "soft" out and the fatal error becomes the first kept.
  f.box.report(error("soft"));
  f.box.report(error("cause", true));
  for (int i = 0; i < 49; i++) {
    f.box.report(error("after " + std::to_string(i)));
  }
  CHECK(f.box.count() == 50);
  CHECK(f.backend->shown.back().error.message == "cause");
  CHECK(f.backend->shown.back().index == 0);
}

TEST_CASE("a later error made fatal by the same message again does not take the box") {
  Fixture f;
  f.box.report(error("cause", true));
  f.box.report(error("follows"));
  f.box.report(error("follows", true));
  CHECK(f.box.count() == 2);
  CHECK(f.backend->shown.back().error.message == "cause");
}

TEST_CASE("a fatal error's symbolicated stack goes to the log, a soft one's does not") {
  Fixture f;
  std::vector<std::string> logged;
  f.box.log = [&](const std::string &text) { logged.push_back(text); };
  f.box.report(error("TypeError: undefined cannot be used as a constructor", true));
  f.box.report(error("soft"));
  REQUIRE(f.http->sent.size() == 2);
  auto stack = R"({"stack": [
    {"methodName": "<global>", "file": "/app/src/app/shared.ts", "lineNumber": 3, "column": 14, "collapse": false},
    {"methodName": "loadModuleImplementation", "file": "/app/node_modules/metro-runtime/src/polyfills/require.js", "lineNumber": 9, "column": 1, "collapse": true}
  ]})";
  answer(*f.http->sent[1], stack);
  CHECK(logged.empty());
  answer(*f.http->sent[0], stack);
  REQUIRE(logged.size() == 1);
  CHECK(
      logged[0] ==
      "TypeError: undefined cannot be used as a constructor\n"
      "    at <global> (/app/src/app/shared.ts:3:14)");
}
