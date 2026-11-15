// SwiftEngine (language-model.mm and language-model.swift) on the Mac running the tests: Foundation
// Models where macOS 26 and Apple Intelligence give it, and the answers that say why not elsewhere.
#include "../language-model.h"

#include <doctest/doctest.h>

#include <memory>
#include <mutex>

#import <Foundation/Foundation.h>

#include <atomic>
#include <chrono>
#include <set>
#include <thread>

namespace {

template <typename Done>
bool waitFor(Done done, double seconds) {
  auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(static_cast<int>(seconds * 1000));
  while (!done() && std::chrono::steady_clock::now() < until) {
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  return done();
}

bool hasFoundationModels() {
  return NSProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26;
}

} // namespace

TEST_CASE("SwiftEngine answers an availability expo-local-llm names, notEligible before macOS 26") {
  auto availability = ngn::appkit::makeLanguageModelEngine()->availability();
  CHECK(std::set<std::string>{"available", "notEligible", "notEnabled", "notReady", "unknown"}.count(availability) == 1);
  if (!hasFoundationModels()) {
    CHECK(availability == "notEligible");
  }
  MESSAGE("this Mac's on-device model: " << availability);
}

TEST_CASE("SwiftEngine refuses a schema the model cannot take, with the reason") {
  auto module = ngn::makeLocalLlmModule(ngn::appkit::makeLanguageModelEngine());
  folly::dynamic config = folly::dynamic::object("responseFormat", "json")("schema", folly::dynamic::object("when", folly::dynamic::object("type", "date")));
  CHECK_THROWS_WITH(module->call("createSession", folly::dynamic::array(config)),
                    doctest::Contains(hasFoundationModels() ? "Unsupported schema type: date" : "needs macOS 26"));
  // A tool's parameters are a schema too.
  folly::dynamic tools = folly::dynamic::object("tools", folly::dynamic::array(folly::dynamic::object("name", "look")("description", "Looks")(
      "parameters", folly::dynamic::object("list", folly::dynamic::object("type", "array")))));
  CHECK_THROWS_WITH(module->call("createSession", folly::dynamic::array(tools)),
                    doctest::Contains(hasFoundationModels() ? "must declare 'items'" : "needs macOS 26"));
}

TEST_CASE("SwiftEngine streams an answer from the on-device model where it is available, and cancels one") {
  auto engine = ngn::appkit::makeLanguageModelEngine();
  auto module = ngn::makeLocalLlmModule(engine);
  if (engine->availability() != "available") {
    auto id = hasFoundationModels() ? module->call("createSession", folly::dynamic::array(folly::dynamic::object())) : folly::dynamic("0");
    std::optional<std::string> refused;
    module->callWithPromise("respond", folly::dynamic::array(id, "Hello", nullptr),
                            {.resolve = [](folly::dynamic) {}, .reject = [&](const std::string &m) { refused = m; }});
    REQUIRE(refused);
    MESSAGE("the on-device model is not available here; only the refusal is checked: " << *refused);
    return;
  }
  // What the callbacks write lives as long as they do, past a timeout and the module's teardown.
  struct Seen {
    std::atomic<int> tokens{0};
    std::atomic<bool> done{false};
    std::atomic<bool> stopped{false};
    std::mutex mutex;
    std::string text;
    std::string failure;
  };
  auto seen = std::make_shared<Seen>();
  module->setEmitter([seen](const std::string &, folly::dynamic body) {
    if (body["type"] == "token") {
      seen->tokens++;
    }
  });
  auto id = module->call("createSession", folly::dynamic::array(folly::dynamic::object("instructions", "Answer in one short sentence.")));
  auto cancel = [&] { module->callWithPromise("cancelStream", folly::dynamic::array(id), {.resolve = [](folly::dynamic) {}, .reject = {}}); };
  module->callWithPromise("streamResponse", folly::dynamic::array(id, "What colour is the sky on a clear day?", "r1"),
                          {.resolve =
                               [seen](folly::dynamic v) {
                                 std::lock_guard lock(seen->mutex);
                                 seen->text = v.asString();
                                 seen->done = true;
                               },
                           .reject =
                               [seen](const std::string &m) {
                                 std::lock_guard lock(seen->mutex);
                                 seen->failure = m;
                                 seen->done = true;
                               }});
  bool answered = waitFor([&] { return seen->done.load(); }, 60);
  if (!answered) {
    cancel();
  }
  REQUIRE(answered);
  {
    std::lock_guard lock(seen->mutex);
    CHECK(seen->failure.empty());
    CHECK_FALSE(seen->text.empty());
  }
  CHECK(seen->tokens > 0);

  module->callWithPromise("streamResponse", folly::dynamic::array(id, "Write a long story about the sea.", "r2"),
                          {.resolve = [seen](folly::dynamic) { seen->stopped = true; },
                           .reject =
                               [seen](const std::string &m) {
                                 std::lock_guard lock(seen->mutex);
                                 seen->failure = m;
                                 seen->stopped = true;
                               }});
  cancel();
  REQUIRE(waitFor([&] { return seen->stopped.load(); }, 30));
  std::lock_guard lock(seen->mutex);
  CHECK(seen->failure.empty());
}

TEST_CASE("SwiftEngine refuses a tool timeout that is not a number of seconds it can wait") {
  auto module = ngn::makeLocalLlmModule(ngn::appkit::makeLanguageModelEngine());
  for (double timeout : {-1.0, 0.0, 1e20}) {
    CHECK_THROWS_WITH(module->call("createSession", folly::dynamic::array(folly::dynamic::object("toolTimeout", timeout))),
                      doctest::Contains(hasFoundationModels() ? "toolTimeout" : "needs macOS 26"));
  }
  if (hasFoundationModels()) {
    CHECK_NOTHROW(module->call("createSession", folly::dynamic::array(folly::dynamic::object("toolTimeout", 5))));
  }
}
