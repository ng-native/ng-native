#include "fake-network.h"

#include <doctest/doctest.h>
#include <folly/io/IOBuf.h>

using namespace facebook::react;
using ngn::testing::FakeHttp;
using ngn::testing::FakeWebSockets;

TEST_CASE("React Native's HTTP client sends through the backend and gets the body once") {
  auto http = std::make_shared<FakeHttp>();
  auto client = ngn::httpClientFactory(http)();
  std::vector<std::string> log;
  http::NetworkCallbacks callbacks{
      .onResponse = [&](uint16_t status, const http::Headers &headers) {
        log.push_back("response " + std::to_string(status) + " " + headers.at(0).second);
      },
      .onBody = [&](std::unique_ptr<folly::IOBuf> body) { log.push_back("body " + body->moveToFbString().toStdString()); },
      .onResponseComplete = [&](const std::string &error, bool timeout) {
        log.push_back("complete '" + error + "' " + (timeout ? "timeout" : "ok"));
      },
  };
  http::Body body;
  body.string = "payload";
  client->sendRequest(std::move(callbacks), "POST", "http://h/x", {{"A", "1"}}, body, 1500);

  REQUIRE(http->sent.size() == 1);
  auto &sent = *http->sent[0];
  CHECK(sent.request.method == "POST");
  CHECK(sent.request.url == "http://h/x");
  CHECK(sent.request.body == "payload");
  CHECK(sent.request.timeoutMs == 1500);
  CHECK(sent.request.headers == ngn::Headers{{"A", "1"}});

  sent.callbacks.onResponse({.status = 200, .headers = {{"Content-Type", "text/plain"}}, .url = "http://h/x"});
  sent.callbacks.onData("hel", 5);
  sent.callbacks.onData("lo", 5);
  sent.callbacks.onComplete("", false);
  CHECK(log == std::vector<std::string>{"response 200 text/plain", "body hello", "complete '' ok"});
}

TEST_CASE("React Native's HTTP client streams chunks when it asks for incremental updates") {
  auto http = std::make_shared<FakeHttp>();
  auto client = ngn::httpClientFactory(http)();
  std::vector<std::string> log;
  http::NetworkCallbacks callbacks{
      .onBody = [&](std::unique_ptr<folly::IOBuf>) { log.push_back("whole body"); },
      .onBodyIncremental =
          [&](int64_t progress, int64_t total, std::unique_ptr<folly::IOBuf> chunk) -> int64_t {
        log.push_back(chunk->moveToFbString().toStdString() + " " + std::to_string(progress) + "/" +
                      std::to_string(total));
        return 0;
      },
      .sendIncrementalUpdates = true,
  };
  auto token = client->sendRequest(std::move(callbacks), "GET", "http://h/stream");
  auto &sent = *http->sent[0];
  sent.callbacks.onData("ab", -1);
  sent.callbacks.onData("cde", -1);
  sent.callbacks.onComplete("", false);
  CHECK(log == std::vector<std::string>{"ab 2/-1", "cde 5/-1"});

  token->cancel();
  CHECK(sent.cancelled);
}

TEST_CASE("a failed request reports its error and no body") {
  auto http = std::make_shared<FakeHttp>();
  auto client = ngn::httpClientFactory(http)();
  bool gotBody = false;
  std::string error;
  client->sendRequest(
      {.onBody = [&](std::unique_ptr<folly::IOBuf>) { gotBody = true; },
       .onResponseComplete = [&](const std::string &e, bool) { error = e; }},
      "GET",
      "http://h/");
  http->sent[0]->callbacks.onComplete("Could not connect to the server.", false);
  CHECK_FALSE(gotBody);
  CHECK(error == "Could not connect to the server.");
}

TEST_CASE("React Native's WebSocket client connects, receives and closes through the backend") {
  auto sockets = std::make_shared<FakeWebSockets>();
  auto client = ngn::webSocketClientFactory(sockets)();
  std::vector<std::string> log;
  client->setOnMessageCallback([&](const std::string &m) { log.push_back("message " + m); });
  client->setOnClosedCallback([&](const std::string &r) { log.push_back("closed " + r); });
  client->connect("ws://localhost:8081/message", [&](bool ok, const std::string &e) {
    log.push_back(std::string(ok ? "open" : "failed ") + e);
  });

  REQUIRE(sockets->connections.size() == 1);
  auto &c = *sockets->connections[0];
  CHECK(c.url == "ws://localhost:8081/message");
  c.callbacks.onOpen("");
  c.callbacks.onText("{\"version\":2,\"method\":\"reload\"}");
  client->send("hi");
  client->ping();
  c.callbacks.onClose(1001, "going away");
  CHECK(log == std::vector<std::string>{"open", "message {\"version\":2,\"method\":\"reload\"}", "closed going away"});
  CHECK(c.log == std::vector<std::string>{"text hi", "ping"});
}

TEST_CASE("a WebSocket that fails before it opens answers connect, not the close callback") {
  auto sockets = std::make_shared<FakeWebSockets>();
  auto client = ngn::webSocketClientFactory(sockets)();
  std::vector<std::string> log;
  client->setOnClosedCallback([&](const std::string &r) { log.push_back("closed " + r); });
  client->connect("ws://localhost:1/message", [&](bool ok, const std::string &e) {
    log.push_back(std::string(ok ? "open" : "failed ") + e);
  });
  sockets->connections[0]->callbacks.onError("refused");
  CHECK(log == std::vector<std::string>{"failed refused"});

  // After it opened, a failure closes it.
  client->connect("ws://localhost:2/message", [&](bool ok, const std::string &) { log.push_back(ok ? "open" : "failed"); });
  sockets->connections[1]->callbacks.onOpen("");
  sockets->connections[1]->callbacks.onError("reset");
  CHECK(log == std::vector<std::string>{"failed refused", "open", "closed reset"});
}

TEST_CASE("destroying React Native's WebSocket client closes the connection and silences it") {
  auto sockets = std::make_shared<FakeWebSockets>();
  auto client = ngn::webSocketClientFactory(sockets)();
  int messages = 0;
  client->setOnMessageCallback([&](const std::string &) { messages++; });
  client->connect("ws://h/", nullptr);
  auto c = sockets->connections[0];
  client.reset();
  c->callbacks.onText("late");
  CHECK(messages == 0);
  CHECK(c->log == std::vector<std::string>{"close 1000 "});
}
