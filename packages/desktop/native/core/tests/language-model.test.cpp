#include "ngn/language-model.h"

#include <doctest/doctest.h>

#include <folly/json.h>

#include <optional>
#include <vector>

using folly::dynamic;

namespace {

struct FakeSession final : ngn::LanguageModelEngine::Session {
  struct Log {
    std::vector<std::string> prompts;
    std::vector<std::pair<std::string, std::string>> answers;
    int cancels{0};
    int released{0};
  };
  std::shared_ptr<Log> log;
  std::function<void(const std::string &)> onText;
  std::function<void(ngn::LanguageModelEngine::Outcome)> done;
  explicit FakeSession(std::shared_ptr<Log> l) : log(std::move(l)) {}
  ~FakeSession() override {
    log->released++;
  }
  void respond(const std::string &prompt, bool stream, std::function<void(const std::string &)> text,
               std::function<void(ngn::LanguageModelEngine::Outcome)> finish) override {
    log->prompts.push_back((stream ? "stream " : "respond ") + prompt);
    onText = std::move(text);
    done = std::move(finish);
  }
  void cancel() override {
    log->cancels++;
  }
  void answerTool(const std::string &callId, const std::optional<std::string> &output, const std::string &error) override {
    log->answers.emplace_back(callId, output ? *output : "error " + error);
  }
};

struct FakeEngine final : ngn::LanguageModelEngine {
  std::string now{"available"};
  std::string config;
  std::string refuse;
  std::shared_ptr<FakeSession::Log> log = std::make_shared<FakeSession::Log>();
  FakeSession *last{nullptr};
  std::function<void(ToolCall)> onToolCall;
  std::string availability() override {
    return now;
  }
  std::unique_ptr<Session> session(const std::string &c, std::function<void(ToolCall)> calls, std::string &error) override {
    config = c;
    if (!refuse.empty()) {
      error = refuse;
      return nullptr;
    }
    onToolCall = std::move(calls);
    auto session = std::make_unique<FakeSession>(log);
    last = session.get();
    return session;
  }
};

struct Setup {
  std::shared_ptr<FakeEngine> engine = std::make_shared<FakeEngine>();
  std::shared_ptr<ngn::NativeModule> module = ngn::makeLocalLlmModule(engine);
  std::vector<dynamic> events;
  Setup() {
    module->setEmitter([this](const std::string &event, dynamic body) {
      CHECK(event == "ngNativeLocalLlm");
      events.push_back(std::move(body));
    });
  }
  struct Answer {
    std::optional<dynamic> value;
    std::optional<std::string> failure;
  };
  std::shared_ptr<Answer> start(const std::string &method, dynamic args) {
    auto answer = std::make_shared<Answer>();
    module->callWithPromise(method, args, {.resolve = [answer](dynamic v) { answer->value = v; },
                                           .reject = [answer](const std::string &m) { answer->failure = m; }});
    return answer;
  }
};

} // namespace

TEST_CASE("NgNativeLocalLlm answers the engine's availability, and a download with nothing to do") {
  Setup s;
  CHECK(s.module->call("getAvailability") == dynamic("available"));
  s.engine->now = "notEnabled";
  CHECK(s.module->call("getAvailability") == dynamic("notEnabled"));
  auto download = s.start("downloadModel", dynamic::array());
  CHECK(download->value == dynamic(nullptr));
}

TEST_CASE("NgNativeLocalLlm makes a session from expo-local-llm's config, and throws for one the model refuses") {
  Setup s;
  dynamic config = dynamic::object("instructions", "Be brief")("options", dynamic::object("temperature", 0.2));
  auto id = s.module->call("createSession", dynamic::array(config));
  CHECK(id.isString());
  CHECK(folly::parseJson(s.engine->config) == config);
  s.engine->refuse = "Malformed schema: Field 'a' must be an object";
  CHECK_THROWS_WITH(s.module->call("createSession", dynamic::array(dynamic::object())),
                    doctest::Contains("Malformed schema"));
}

TEST_CASE("NgNativeLocalLlm responds, streams with token events for the request, and resolves the whole text") {
  Setup s;
  auto id = s.module->call("createSession", dynamic::array(dynamic::object()));
  auto answer = s.start("respond", dynamic::array(id, "Hello", nullptr));
  CHECK(s.engine->log->prompts.back() == "respond Hello");
  s.engine->last->done({.text = "Hi"});
  CHECK(answer->value == dynamic("Hi"));

  auto streamed = s.start("streamResponse", dynamic::array(id, "Count", "r1"));
  CHECK(s.engine->log->prompts.back() == "stream Count");
  s.engine->last->onText("1");
  s.engine->last->onText("1 2");
  REQUIRE(s.events.size() == 2);
  CHECK(s.events[1] == dynamic::object("type", "token")("session", id)("requestId", "r1")("accumulated", "1 2"));
  s.engine->last->done({.text = "1 2 3"});
  CHECK(streamed->value == dynamic("1 2 3"));
}

TEST_CASE("NgNativeLocalLlm refuses a turn while the model is unavailable, and while the last one runs") {
  Setup s;
  auto id = s.module->call("createSession", dynamic::array(dynamic::object()));
  s.engine->now = "notEnabled";
  auto refused = s.start("respond", dynamic::array(id, "Hello", nullptr));
  REQUIRE(refused->failure);
  CHECK(refused->failure->rfind("ERR_MODEL_UNAVAILABLE: ", 0) == 0);
  CHECK(s.engine->log->prompts.empty());

  s.engine->now = "available";
  auto first = s.start("streamResponse", dynamic::array(id, "One", "r1"));
  auto second = s.start("streamResponse", dynamic::array(id, "Two", "r2"));
  REQUIRE(second->failure);
  CHECK(second->failure->rfind("ERR_SESSION_BUSY: ", 0) == 0);
  s.engine->last->done({.text = "done"});
  // Once the turn has ended the session takes the next.
  s.start("respond", dynamic::array(id, "Three", nullptr));
  CHECK(s.engine->log->prompts.back() == "respond Three");
}

TEST_CASE("NgNativeLocalLlm rejects with the model's code, and resolves a cancelled turn with the text so far") {
  Setup s;
  auto id = s.module->call("createSession", dynamic::array(dynamic::object()));
  auto failed = s.start("respond", dynamic::array(id, "A long one", nullptr));
  s.engine->last->done({.code = "ERR_CONTEXT_WINDOW_EXCEEDED", .message = "Exceeded the context window"});
  REQUIRE(failed->failure);
  CHECK(*failed->failure == "ERR_CONTEXT_WINDOW_EXCEEDED: Exceeded the context window");

  auto streamed = s.start("streamResponse", dynamic::array(id, "Write", "r2"));
  s.engine->last->onText("Once upon");
  auto cancel = s.start("cancelStream", dynamic::array(id));
  CHECK(cancel->value == dynamic(nullptr));
  CHECK(s.engine->log->cancels == 1);
  // The model stops with a cancellation, or any other failure after the cancel.
  s.engine->last->done({.code = "ERR_GENERATION_FAILED", .message = "stopped"});
  CHECK(streamed->value == dynamic("Once upon"));
}

TEST_CASE("NgNativeLocalLlm sends a tool call with the turn's request, and passes the answer back") {
  Setup s;
  auto id = s.module->call("createSession", dynamic::array(dynamic::object("tools", dynamic::array(dynamic::object("name", "weather")))));
  s.start("streamResponse", dynamic::array(id, "Weather?", "r7"));
  s.engine->onToolCall({.id = "c1", .tool = "weather", .arguments = R"({"city":"Leeds"})"});
  REQUIRE(s.events.size() == 1);
  CHECK(s.events[0] == dynamic::object("type", "toolCall")("session", id)("requestId", "r7")("callId", "c1")("toolName", "weather")(
                           "arguments", dynamic::object("city", "Leeds")));
  s.module->call("resolveToolCall", dynamic::array(id, "c1", "Rain"));
  s.module->call("rejectToolCall", dynamic::array(id, "c2", "No such city"));
  REQUIRE(s.engine->log->answers.size() == 2);
  CHECK(s.engine->log->answers[0] == std::pair<std::string, std::string>("c1", "Rain"));
  CHECK(s.engine->log->answers[1] == std::pair<std::string, std::string>("c2", "error No such city"));
}

TEST_CASE("NgNativeLocalLlm releases a session, and every session when a reload ends the module") {
  Setup s;
  auto a = s.module->call("createSession", dynamic::array(dynamic::object()));
  s.module->call("createSession", dynamic::array(dynamic::object()));
  auto pending = s.start("respond", dynamic::array(a, "Hello", nullptr));
  auto done = s.engine->last->done;
  s.module->call("release", dynamic::array(a));
  CHECK(s.engine->log->released == 1);
  // A turn on a released session is refused.
  auto refused = s.start("respond", dynamic::array(a, "Again", nullptr));
  REQUIRE(refused->failure);
  CHECK(refused->failure->find("released") != std::string::npos);
  auto log = s.engine->log;
  auto calls = s.engine->onToolCall;
  s.module.reset();
  CHECK(log->released == 2);
  // What the model sends after the module is gone goes nowhere.
  s.events.clear();
  calls({.id = "c1", .tool = "weather", .arguments = "{}"});
  CHECK(s.events.empty());
}
