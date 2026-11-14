// SwiftEngine (language-model.mm and language-model.swift) on the Mac running the tests: Foundation
// Models where macOS 26 and Apple Intelligence give it, and the answers that say why not elsewhere.
#include "../language-model.h"

#include <doctest/doctest.h>

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
  std::atomic<int> tokens{0};
  module->setEmitter([&](const std::string &, folly::dynamic body) {
    if (body["type"] == "token") {
      tokens++;
    }
  });
  auto id = module->call("createSession", folly::dynamic::array(folly::dynamic::object("instructions", "Answer in one short sentence.")));
  std::atomic<bool> done{false};
  std::string text;
  std::string failure;
  module->callWithPromise("streamResponse", folly::dynamic::array(id, "What colour is the sky on a clear day?", "r1"),
                          {.resolve = [&](folly::dynamic v) { text = v.asString(); done = true; },
                           .reject = [&](const std::string &m) { failure = m; done = true; }});
  REQUIRE(waitFor([&] { return done.load(); }, 60));
  CHECK(failure.empty());
  CHECK_FALSE(text.empty());
  CHECK(tokens > 0);

  std::atomic<bool> stopped{false};
  module->callWithPromise("streamResponse", folly::dynamic::array(id, "Write a long story about the sea.", "r2"),
                          {.resolve = [&](folly::dynamic) { stopped = true; }, .reject = [&](const std::string &m) { failure = m; stopped = true; }});
  module->callWithPromise("cancelStream", folly::dynamic::array(id), {.resolve = [](folly::dynamic) {}, .reject = {}});
  REQUIRE(waitFor([&] { return stopped.load(); }, 30));
  CHECK(failure.empty());
}
