#include "fake-network.h"

namespace ngn::testing {

namespace {

struct FakeTask final : HttpTask {
  explicit FakeTask(std::shared_ptr<FakeHttp::Sent> sent) : sent(std::move(sent)) {}
  void cancel() override {
    sent->cancelled = true;
  }
  std::shared_ptr<FakeHttp::Sent> sent;
};

struct FakeConnection final : WebSocketConnection {
  explicit FakeConnection(std::shared_ptr<FakeWebSockets::Connection> c) : c(std::move(c)) {}
  void sendText(const std::string &text) override {
    c->log.push_back("text " + text);
  }
  void sendBinary(const std::string &bytes) override {
    c->log.push_back("binary " + bytes);
  }
  void ping() override {
    c->log.push_back("ping");
  }
  void close(int code, const std::string &reason) override {
    c->log.push_back("close " + std::to_string(code) + " " + reason);
  }
  std::shared_ptr<FakeWebSockets::Connection> c;
};

} // namespace

std::unique_ptr<HttpTask> FakeHttp::send(HttpRequest request, HttpCallbacks callbacks) {
  auto s = std::make_shared<Sent>(Sent{std::move(request), std::move(callbacks)});
  sent.push_back(s);
  return std::make_unique<FakeTask>(s);
}

void FakeHttp::clearCookies(std::function<void(bool)> done) {
  cookieClears++;
  if (done) {
    done(true);
  }
}

std::unique_ptr<WebSocketConnection> FakeWebSockets::connect(
    const std::string &url,
    const std::vector<std::string> &protocols,
    const Headers &headers,
    WebSocketCallbacks callbacks) {
  auto c = std::make_shared<Connection>(Connection{url, protocols, headers, std::move(callbacks), {}});
  connections.push_back(c);
  return std::make_unique<FakeConnection>(c);
}

} // namespace ngn::testing
