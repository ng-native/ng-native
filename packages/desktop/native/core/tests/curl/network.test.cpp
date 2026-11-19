// The libcurl client (curl-network.h) against a real server on this machine, test-server.py, which
// each test starts and stops.
#include "ngn/curl-network.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <thread>

extern char **environ;

using namespace std::chrono_literals;
using ngn::CaCertificates;
using ngn::CaProbe;
using ngn::Headers;
using ngn::HttpRequest;

namespace {

using Clock = std::chrono::steady_clock;

// Requests to this machine bypass any proxy the environment names, for as long as this lives, so a
// developer's proxy never answers for the local server or a closed port.
class LoopbackBypassesProxy {
 public:
  LoopbackBypassesProxy() {
    for (const char *name : {"no_proxy", "NO_PROXY"}) {
      const char *value = std::getenv(name);
      saved_[name] = value ? std::optional<std::string>(value) : std::nullopt;
      setenv(name, "127.0.0.1,localhost", 1);
    }
  }
  ~LoopbackBypassesProxy() {
    for (const auto &[name, value] : saved_) {
      if (value) {
        setenv(name.c_str(), value->c_str(), 1);
      } else {
        unsetenv(name.c_str());
      }
    }
  }
  LoopbackBypassesProxy(const LoopbackBypassesProxy &) = delete;
  LoopbackBypassesProxy &operator=(const LoopbackBypassesProxy &) = delete;

 private:
  std::map<std::string, std::optional<std::string>> saved_;
};

// test-server.py, for as long as this lives.
class TestServer {
 public:
  TestServer() {
    int in[2], out[2];
    if (pipe(in) != 0) {
      throw std::runtime_error("pipe failed");
    }
    if (pipe(out) != 0) {
      close(in[0]);
      close(in[1]);
      throw std::runtime_error("pipe failed");
    }
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, in[0], 0);
    posix_spawn_file_actions_adddup2(&actions, out[1], 1);
    posix_spawn_file_actions_addclose(&actions, in[1]);
    posix_spawn_file_actions_addclose(&actions, out[0]);
    char python[] = "python3";
    char script[] = NGN_CURL_TEST_SERVER;
    char *argv[] = {python, script, nullptr};
    int spawned = posix_spawnp(&pid_, "python3", &actions, nullptr, argv, environ);
    posix_spawn_file_actions_destroy(&actions);
    close(in[0]);
    close(out[1]);
    if (spawned != 0) {
      close(in[1]);
      close(out[0]);
      throw std::runtime_error("could not start python3");
    }
    stdin_ = in[1];
    std::string line;
    char c;
    while (read(out[0], &c, 1) == 1 && c != '\n') {
      line += c;
    }
    close(out[0]);
    try {
      port_ = std::stoi(line);
    } catch (...) {
      stop();
      throw;
    }
  }

  ~TestServer() {
    stop();
  }
  TestServer(const TestServer &) = delete;
  TestServer &operator=(const TestServer &) = delete;

  std::string url(const std::string &path) const {
    return "http://127.0.0.1:" + std::to_string(port_) + path;
  }

  std::string ws(const std::string &path) const {
    return "ws://127.0.0.1:" + std::to_string(port_) + path;
  }

 private:
  // Its stdin closing ends it.
  void stop() {
    close(stdin_);
    int status;
    waitpid(pid_, &status, 0);
  }

  LoopbackBypassesProxy bypass_;
  pid_t pid_{0};
  int stdin_{-1};
  int port_{0};
};

// One request's callbacks, recorded.
struct Recorder {
  std::mutex mutex;
  std::condition_variable changed;
  std::vector<std::string> events;
  ngn::HttpResponse response;
  std::string body;
  int64_t expected{-2};
  std::vector<std::pair<int64_t, int64_t>> uploads;
  std::string error;
  bool timedOut{false};
  bool complete{false};
  std::thread::id thread;

  ngn::HttpCallbacks callbacks() {
    return {
        .onUploadProgress =
            [this](int64_t sent, int64_t total) {
              std::lock_guard lock(mutex);
              uploads.emplace_back(sent, total);
            },
        .onResponse =
            [this](const ngn::HttpResponse &r) {
              std::lock_guard lock(mutex);
              events.push_back("response");
              response = r;
              thread = std::this_thread::get_id();
              changed.notify_all();
            },
        .onData =
            [this](std::string chunk, int64_t e) {
              std::lock_guard lock(mutex);
              if (events.empty() || events.back() != "data") {
                events.push_back("data");
              }
              body += chunk;
              expected = e;
            },
        .onComplete =
            [this](const std::string &e, bool t) {
              std::lock_guard lock(mutex);
              events.push_back("complete");
              error = e;
              timedOut = t;
              complete = true;
              changed.notify_all();
            },
    };
  }

  // The callbacks, holding `self` until the last of them is gone, for a recorder that may go out
  // of scope before the network does.
  static ngn::HttpCallbacks owned(const std::shared_ptr<Recorder> &self) {
    auto c = self->callbacks();
    return {
        .onUploadProgress = [self, f = c.onUploadProgress](int64_t sent, int64_t total) { f(sent, total); },
        .onResponse = [self, f = c.onResponse](const ngn::HttpResponse &r) { f(r); },
        .onData = [self, f = c.onData](std::string chunk, int64_t e) { f(std::move(chunk), e); },
        .onComplete = [self, f = c.onComplete](const std::string &e, bool t) { f(e, t); },
    };
  }

  bool waitForResponse(std::chrono::milliseconds limit = 10s) {
    std::unique_lock lock(mutex);
    return changed.wait_for(lock, limit, [&] { return !events.empty(); });
  }

  bool waitForComplete(std::chrono::milliseconds limit = 10s) {
    std::unique_lock lock(mutex);
    return changed.wait_for(lock, limit, [&] { return complete; });
  }

  std::string header(const std::string &name) {
    std::lock_guard lock(mutex);
    std::string out;
    for (const auto &[k, v] : response.headers) {
      if (k == name) {
        out += (out.empty() ? "" : ",") + v;
      }
    }
    return out;
  }
};

// One connection's callbacks, recorded.
struct SocketRecorder {
  std::mutex mutex;
  std::condition_variable changed;
  std::vector<std::string> events;

  ngn::WebSocketCallbacks callbacks() {
    auto add = [this](std::string event) {
      std::lock_guard lock(mutex);
      events.push_back(std::move(event));
      changed.notify_all();
    };
    return {
        .onOpen = [add](const std::string &protocol) { add("open " + protocol); },
        .onText = [add](const std::string &text) { add("text " + (text.size() > 40 ? std::to_string(text.size()) + " bytes" : text)); },
        .onBinary = [add](const std::string &bytes) { add("binary " + std::to_string(bytes.size()) + (bytes == std::string("\0\1\2", 3) ? " 0 1 2" : "")); },
        .onClose = [add](int code, const std::string &reason) { add("close " + std::to_string(code) + " " + reason); },
        .onError = [add](const std::string &message) { add("error " + message); },
    };
  }

  bool waitFor(size_t count, std::chrono::milliseconds limit = 10s) {
    std::unique_lock lock(mutex);
    return changed.wait_for(lock, limit, [&] { return events.size() >= count; });
  }

  std::vector<std::string> seen() {
    std::lock_guard lock(mutex);
    return events;
  }
};

folly::dynamic echoed(Recorder &r) {
  std::lock_guard lock(r.mutex);
  return folly::parseJson(r.body);
}

std::string echoedHeader(const folly::dynamic &echo, const std::string &name) {
  for (const auto &h : echo["headers"]) {
    std::string key = h[0].asString();
    for (auto &c : key) {
      c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    if (key == name) {
      return h[1].asString();
    }
  }
  return "<none>";
}

// Holds the network's thread inside a request's callback until released, so what a test does
// meanwhile waits behind it. Released when it goes, whatever happened.
class WorkerGate {
 public:
  WorkerGate(ngn::Http &http, const std::string &url) {
    task_ = http.send(
        {.url = url},
        {.onResponse = [s = state_](const ngn::HttpResponse &) {
          std::unique_lock lock(s->mutex);
          s->held = true;
          s->changed.notify_all();
          s->changed.wait(lock, [&] { return s->released; });
        }});
  }
  ~WorkerGate() {
    release();
  }
  WorkerGate(const WorkerGate &) = delete;
  WorkerGate &operator=(const WorkerGate &) = delete;

  bool waitUntilHeld() {
    std::unique_lock lock(state_->mutex);
    return state_->changed.wait_for(lock, 10s, [&] { return state_->held; });
  }

  void release() {
    std::lock_guard lock(state_->mutex);
    state_->released = true;
    state_->changed.notify_all();
  }

 private:
  struct State {
    std::mutex mutex;
    std::condition_variable changed;
    bool held{false};
    bool released{false};
  };
  std::shared_ptr<State> state_ = std::make_shared<State>();
  std::unique_ptr<ngn::HttpTask> task_;
};

// What test-server.py has logged of the WebSockets it served, once it has logged anything.
std::string serverLog(const TestServer &server, ngn::Http &http) {
  auto deadline = Clock::now() + 10s;
  for (;;) {
    auto r = std::make_shared<Recorder>();
    http.send({.url = server.url("/ws-log")}, Recorder::owned(r));
    if (!r->waitForComplete()) {
      return "<no answer>";
    }
    std::lock_guard lock(r->mutex);
    if (r->body != "[]" || Clock::now() > deadline) {
      return r->body;
    }
    std::this_thread::sleep_for(20ms);
  }
}

// A port nothing listens on.
int closedPort() {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  bind(fd, reinterpret_cast<sockaddr *>(&address), sizeof address);
  socklen_t length = sizeof address;
  getsockname(fd, reinterpret_cast<sockaddr *>(&address), &length);
  close(fd);
  return ntohs(address.sin_port);
}

} // namespace

TEST_CASE("a GET over libcurl answers its status, headers and body, once each, off the caller's thread") {
  TestServer server;
  Recorder r;
  auto network = ngn::makeCurlNetwork();
  auto task = network.http->send({.url = server.url("/text")}, r.callbacks());
  REQUIRE(task);
  REQUIRE(r.waitForComplete());
  CHECK(r.events == std::vector<std::string>{"response", "data", "complete"});
  CHECK(r.response.status == 200);
  CHECK(r.response.url == server.url("/text"));
  CHECK(r.header("Content-Type") == "text/plain");
  CHECK(r.header("X-Test") == "a,b");
  CHECK(r.body == "hello");
  CHECK(r.expected == 5);
  CHECK(r.error.empty());
  CHECK_FALSE(r.timedOut);
  CHECK(r.thread != std::this_thread::get_id());
}

TEST_CASE("a POST over libcurl sends its body and headers, reports the upload, and adds no headers of curl's own") {
  TestServer server;
  // Before the network, so they outlive its thread when a REQUIRE fails.
  Recorder r, named, big, del;
  auto network = ngn::makeCurlNetwork();

  network.http->send(
      {.method = "POST", .url = server.url("/echo"), .headers = {{"X-Custom", "yes"}, {"X-Empty", ""}}, .body = "a=1&b=2"},
      r.callbacks());
  REQUIRE(r.waitForComplete());
  auto echo = echoed(r);
  CHECK(echo["method"] == "POST");
  CHECK(echo["body"] == "a=1&b=2");
  CHECK(echoedHeader(echo, "x-custom") == "yes");
  CHECK(echoedHeader(echo, "x-empty") == "");
  // curl's url-encoded-form default, which NSURLSession never adds.
  CHECK(echoedHeader(echo, "content-type") == "<none>");
  REQUIRE_FALSE(r.uploads.empty());
  CHECK(r.uploads.back() == std::pair<int64_t, int64_t>{7, 7});
  // A User-Agent, as NSURLSession always sends one, unless the request names its own.
  CHECK(echoedHeader(echo, "user-agent").starts_with("ng-native libcurl/"));
  network.http->send({.url = server.url("/echo"), .headers = {{"User-Agent", "notes/1.0"}}}, named.callbacks());
  REQUIRE(named.waitForComplete());
  CHECK(echoedHeader(echoed(named), "user-agent") == "notes/1.0");

  // A body over curl's 1 MB threshold goes without its Expect: 100-continue wait.
  std::string body(2 * 1024 * 1024, 'x');
  network.http->send(
      {.method = "PUT", .url = server.url("/echo"), .headers = {{"Content-Type", "application/octet-stream"}}, .body = body},
      big.callbacks());
  REQUIRE(big.waitForComplete());
  auto bigEcho = echoed(big);
  CHECK(bigEcho["method"] == "PUT");
  CHECK(bigEcho["bodyLength"] == static_cast<int64_t>(body.size()));
  CHECK(echoedHeader(bigEcho, "expect") == "<none>");
  CHECK(echoedHeader(bigEcho, "content-type") == "application/octet-stream");
  REQUIRE_FALSE(big.uploads.empty());
  CHECK(big.uploads.back() == std::pair<int64_t, int64_t>{static_cast<int64_t>(body.size()), static_cast<int64_t>(body.size())});

  // A method with no body sends none.
  network.http->send({.method = "DELETE", .url = server.url("/echo")}, del.callbacks());
  REQUIRE(del.waitForComplete());
  auto delEcho = echoed(del);
  CHECK(delEcho["method"] == "DELETE");
  CHECK(echoedHeader(delEcho, "content-length") == "<none>");
}

TEST_CASE("a request over libcurl that goes quiet for its timeout fails as timed out, and one that keeps sending does not") {
  TestServer server;
  Recorder quiet, drip;
  auto network = ngn::makeCurlNetwork();

  auto start = Clock::now();
  network.http->send({.url = server.url("/slow?ms=4000"), .timeoutMs = 300}, quiet.callbacks());
  REQUIRE(quiet.waitForComplete());
  CHECK(Clock::now() - start < 2s);
  CHECK(quiet.timedOut);
  CHECK(quiet.error == "The request timed out.");
  CHECK(quiet.events == std::vector<std::string>{"complete"});

  // As NSURLSession's, the timeout is the longest silence, not the whole request.
  // Ten bytes 150 ms apart: 1.5 s in all, three times the timeout, with no gap near it.
  network.http->send({.url = server.url("/drip?n=10&ms=150"), .timeoutMs = 500}, drip.callbacks());
  REQUIRE(drip.waitForComplete());
  CHECK_FALSE(drip.timedOut);
  CHECK(drip.error.empty());
  CHECK(drip.body == "xxxxxxxxxx");
}

TEST_CASE("a cancelled request over libcurl calls back nothing after cancel returns") {
  TestServer server;
  Recorder stalled, early, self, after;
  std::unique_ptr<ngn::HttpTask> selfTask;
  std::mutex selfMutex;
  auto network = ngn::makeCurlNetwork();

  auto task = network.http->send({.url = server.url("/stall")}, stalled.callbacks());
  REQUIRE(stalled.waitForResponse());
  task->cancel();
  std::vector<std::string> atCancel;
  {
    std::lock_guard lock(stalled.mutex);
    atCancel = stalled.events;
  }
  std::this_thread::sleep_for(300ms);
  {
    std::lock_guard lock(stalled.mutex);
    CHECK(stalled.events == atCancel);
    CHECK_FALSE(stalled.complete);
  }

  // Cancelled before it starts, it never calls back at all: the thread is held until it is.
  {
    WorkerGate gate(*network.http, server.url("/text"));
    REQUIRE(gate.waitUntilHeld());
    network.http->send({.url = server.url("/text")}, early.callbacks())->cancel();
  }
  // Cancelled from its own callback.
  auto callbacks = self.callbacks();
  auto onResponse = callbacks.onResponse;
  callbacks.onResponse = [&, onResponse](const ngn::HttpResponse &response) {
    onResponse(response);
    std::lock_guard lock(selfMutex);
    selfTask->cancel();
  };
  {
    std::lock_guard lock(selfMutex);
    selfTask = network.http->send({.url = server.url("/text")}, std::move(callbacks));
  }
  REQUIRE(self.waitForResponse());
  // A request after both completes, so the thread has run past them.
  network.http->send({.url = server.url("/text")}, after.callbacks());
  REQUIRE(after.waitForComplete());
  std::this_thread::sleep_for(100ms);
  std::lock_guard earlyLock(early.mutex);
  CHECK(early.events.empty());
  std::lock_guard selfLock(self.mutex);
  CHECK(self.events == std::vector<std::string>{"response"});
}

TEST_CASE("redirects over libcurl are followed to the last response, changing a POST to a GET where NSURLSession does") {
  TestServer server;
  Recorder found, seeOther, put, temporary, loop, emptyLocation, multipleChoices;
  auto network = ngn::makeCurlNetwork();

  network.http->send({.url = server.url("/redirect")}, found.callbacks());
  REQUIRE(found.waitForComplete());
  CHECK(found.events == std::vector<std::string>{"response", "data", "complete"});
  CHECK(found.response.status == 200);
  CHECK(found.response.url == server.url("/text"));
  CHECK(found.body == "hello");

  network.http->send({.method = "POST", .url = server.url("/see-other"), .body = "gone"}, seeOther.callbacks());
  REQUIRE(seeOther.waitForComplete());
  CHECK(echoed(seeOther)["method"] == "GET");
  CHECK(echoed(seeOther)["body"] == "");

  // A 303 makes any method a GET, a custom one too.
  network.http->send({.method = "PUT", .url = server.url("/see-other"), .body = "gone"}, put.callbacks());
  REQUIRE(put.waitForComplete());
  CHECK(echoed(put)["method"] == "GET");

  network.http->send({.method = "POST", .url = server.url("/temporary"), .body = "kept"}, temporary.callbacks());
  REQUIRE(temporary.waitForComplete());
  CHECK(echoed(temporary)["method"] == "POST");
  CHECK(echoed(temporary)["body"] == "kept");

  network.http->send({.url = server.url("/loop")}, loop.callbacks());
  REQUIRE(loop.waitForComplete());
  CHECK(loop.events == std::vector<std::string>{"complete"});
  CHECK(loop.error == "too many HTTP redirects");

  // curl follows any 3xx with a Location, and no other: a 302 whose Location is empty is the
  // response, body and all, and a 300 with one is followed.
  network.http->send({.url = server.url("/empty-location")}, emptyLocation.callbacks());
  REQUIRE(emptyLocation.waitForComplete());
  CHECK(emptyLocation.events == std::vector<std::string>{"response", "data", "complete"});
  CHECK(emptyLocation.response.status == 302);
  CHECK(emptyLocation.body == "stay");
  network.http->send({.url = server.url("/multiple-choices")}, multipleChoices.callbacks());
  REQUIRE(multipleChoices.waitForComplete());
  CHECK(multipleChoices.events == std::vector<std::string>{"response", "data", "complete"});
  CHECK(multipleChoices.response.status == 200);
  CHECK(multipleChoices.response.url == server.url("/text"));
  CHECK(multipleChoices.body == "hello");
}

TEST_CASE("requests over libcurl with credentials share cookies until they are cleared, and one without sends none") {
  TestServer server;
  auto network = ngn::makeCurlNetwork();
  auto get = [&](const std::string &path, bool credentials) {
    auto r = std::make_shared<Recorder>();
    network.http->send({.url = server.url(path), .withCredentials = credentials}, Recorder::owned(r));
    REQUIRE(r->waitForComplete());
    return r;
  };
  // The answer's state is shared with the callback, which may come after the wait gives up.
  struct Answer {
    std::mutex mutex;
    std::condition_variable changed;
    std::optional<bool> cleared;
  };
  auto cleared = [&] {
    auto a = std::make_shared<Answer>();
    network.http->clearCookies([a](bool c) {
      std::lock_guard lock(a->mutex);
      a->cleared = c;
      a->changed.notify_all();
    });
    std::unique_lock lock(a->mutex);
    a->changed.wait_for(lock, 10s, [&] { return a->cleared.has_value(); });
    return a->cleared;
  };

  get("/set-cookie", true);
  CHECK(echoedHeader(echoed(*get("/echo", true)), "cookie") == "flavour=lemon");
  CHECK(echoedHeader(echoed(*get("/echo", false)), "cookie") == "<none>");
  CHECK(cleared() == true);
  CHECK(echoedHeader(echoed(*get("/echo", true)), "cookie") == "<none>");
  CHECK(cleared() == false);
  // A response's cookies are not kept for a request without credentials.
  get("/set-cookie", false);
  CHECK(echoedHeader(echoed(*get("/echo", true)), "cookie") == "<none>");
}

TEST_CASE("a compressed body over libcurl arrives decoded") {
  TestServer server;
  Recorder r;
  auto network = ngn::makeCurlNetwork();
  network.http->send({.url = server.url("/gzip")}, r.callbacks());
  REQUIRE(r.waitForComplete());
  CHECK(r.body == "zipped");
}

TEST_CASE("data and file urls over libcurl answer 200 with no headers, as on macOS") {
  auto network = ngn::makeCurlNetwork();

  Recorder base64;
  network.http->send({.url = "data:text/plain;base64,aGVs bG8="}, base64.callbacks());
  REQUIRE(base64.waitForComplete());
  CHECK(base64.events == std::vector<std::string>{"response", "data", "complete"});
  CHECK(base64.response.status == 200);
  CHECK(base64.response.headers.empty());
  CHECK(base64.body == "hello");

  Recorder plain;
  network.http->send({.url = "data:,a%20b"}, plain.callbacks());
  REQUIRE(plain.waitForComplete());
  CHECK(plain.body == "a b");

  Recorder bad;
  network.http->send({.url = "data:text/plain;base64"}, bad.callbacks());
  REQUIRE(bad.waitForComplete());
  CHECK(bad.error == "Invalid URL: data:text/plain;base64");

  char path[] = "/tmp/ngn-curl-file-XXXXXX";
  int fd = mkstemp(path);
  REQUIRE(fd >= 0);
  try {
    CHECK(write(fd, "on disk", 7) == 7);
    close(fd);
    Recorder file;
    network.http->send({.url = std::string("file://") + path}, file.callbacks());
    REQUIRE(file.waitForComplete());
    CHECK(file.response.status == 200);
    CHECK(file.response.headers.empty());
    CHECK(file.body == "on disk");
  } catch (...) {
    unlink(path);
    throw;
  }
  unlink(path);
}

TEST_CASE("a file url over libcurl that is not a regular file fails at once, and holds up nothing") {
  Recorder fifo, after;
  auto network = ngn::makeCurlNetwork();
  char dir[] = "/tmp/ngn-curl-fifo-XXXXXX";
  REQUIRE(mkdtemp(dir) != nullptr);
  std::string path = std::string(dir) + "/pipe";
  REQUIRE(mkfifo(path.c_str(), 0600) == 0);
  // A FIFO with no writer blocks a read's open. Opening its write end lets one go, so the thread
  // can stop even when the test fails.
  struct Release {
    std::string path, dir;
    ~Release() {
      int fd = open(path.c_str(), O_WRONLY | O_NONBLOCK);
      if (fd >= 0) {
        close(fd);
      }
      unlink(path.c_str());
      rmdir(dir.c_str());
    }
  } release{path, dir};

  network.http->send({.url = "file://" + path}, fifo.callbacks());
  REQUIRE(fifo.waitForComplete(3s));
  CHECK(fifo.events == std::vector<std::string>{"complete"});
  CHECK(fifo.error == "The requested URL was not found on this server.");
  network.http->send({.url = "data:,next"}, after.callbacks());
  REQUIRE(after.waitForComplete(3s));
  CHECK(after.body == "next");
}

TEST_CASE("a url libcurl cannot parse fails at once, and an unreachable server fails as NSURLSession says") {
  LoopbackBypassesProxy bypass;
  Recorder bad, refused;
  auto network = ngn::makeCurlNetwork();
  CHECK_FALSE(network.http->send({.url = "http://[bad"}, bad.callbacks()));
  CHECK(bad.complete);
  CHECK(bad.error == "Invalid URL: http://[bad");

  network.http->send({.url = "http://127.0.0.1:" + std::to_string(closedPort()) + "/"}, refused.callbacks());
  REQUIRE(refused.waitForComplete());
  CHECK(refused.error == "Could not connect to the server.");
  CHECK_FALSE(refused.timedOut);
}

TEST_CASE("a WebSocket over libcurl opens with the server's subprotocol, echoes text and binary, pings, and closes") {
  TestServer server;
  SocketRecorder r;
  auto network = ngn::makeCurlNetwork();
  auto c = network.webSockets->connect(server.ws("/ws"), {"chat", "other"}, {{"X-Custom", "yes"}}, r.callbacks());
  REQUIRE(c);
  // Sent before it opens, held until it does.
  c->sendText("hi");
  REQUIRE(r.waitFor(2));
  c->sendBinary(std::string("\0\1\2", 3));
  c->ping();
  c->sendText("pings");
  c->sendText("fragments");
  REQUIRE(r.waitFor(5));
  c->close(4001, "done");
  REQUIRE(r.waitFor(6));
  CHECK(r.seen() ==
        std::vector<std::string>{"open chat", "text hi", "binary 3 0 1 2", "text 1", "text 200000 bytes", "close 4001 done"});
  // Nothing follows the close, the connection's own on going away included.
  c.reset();
  std::this_thread::sleep_for(100ms);
  CHECK(r.seen().size() == 6);
}

TEST_CASE("a WebSocket over libcurl reports the server's close, and fails when it cannot open") {
  TestServer server;
  SocketRecorder closedByServer, refused, unoffered, unreachable, early;
  auto network = ngn::makeCurlNetwork();

  auto c = network.webSockets->connect(server.ws("/ws"), {}, {}, closedByServer.callbacks());
  c->sendText("close-me");
  REQUIRE(closedByServer.waitFor(2));
  CHECK(closedByServer.seen() == std::vector<std::string>{"open ", "close 4000 bye"});

  auto r = network.webSockets->connect(server.ws("/ws"), {"refuse"}, {}, refused.callbacks());
  REQUIRE(refused.waitFor(1));
  REQUIRE(refused.seen().size() == 1);
  CHECK(refused.seen()[0].starts_with("error "));

  // A subprotocol the client did not offer fails it, as a browser's does.
  auto o = network.webSockets->connect(server.ws("/ws"), {"pick-other"}, {}, unoffered.callbacks());
  REQUIRE(unoffered.waitFor(1));
  std::this_thread::sleep_for(100ms);
  CHECK(unoffered.seen() == std::vector<std::string>{"error There was a bad response from the server."});

  auto u = network.webSockets->connect(
      "ws://127.0.0.1:" + std::to_string(closedPort()) + "/ws", {}, {}, unreachable.callbacks());
  REQUIRE(unreachable.waitFor(1));
  CHECK(unreachable.seen() == std::vector<std::string>{"error Could not connect to the server."});

  // Closed before it opens, as NSURLSession cancels it: the thread is held until both are queued.
  std::unique_ptr<ngn::WebSocketConnection> e;
  {
    WorkerGate gate(*network.http, server.url("/text"));
    REQUIRE(gate.waitUntilHeld());
    e = network.webSockets->connect(server.ws("/ws"), {}, {}, early.callbacks());
    e->close(1000, "");
  }
  REQUIRE(early.waitFor(1));
  std::this_thread::sleep_for(100ms);
  CHECK(early.seen() == std::vector<std::string>{"error cancelled"});
}

TEST_CASE("a WebSocket over libcurl cuts a long close reason before a character, not inside one") {
  TestServer server;
  SocketRecorder r;
  auto network = ngn::makeCurlNetwork();
  auto c = network.webSockets->connect(server.ws("/ws"), {}, {}, r.callbacks());
  REQUIRE(r.waitFor(1));
  // 122 bytes and a two-byte character: 124, one over the 123 a close frame has room for.
  c->close(1000, std::string(122, 'a') + "\xc3\xa9");
  REQUIRE(r.waitFor(2));
  // The server echoes the close frame it got.
  CHECK(r.seen() == std::vector<std::string>{"open ", "close 1000 " + std::string(122, 'a')});
}

TEST_CASE("a WebSocket over libcurl whose close the server never answers closes with 1006, not its own code") {
  TestServer server;
  SocketRecorder dropped, ignored;
  auto network = ngn::makeCurlNetwork();
  // "mute" drops the connection on a close frame, "silent" reads on without answering it.
  auto d = network.webSockets->connect(server.ws("/ws"), {"mute"}, {}, dropped.callbacks());
  auto i = network.webSockets->connect(server.ws("/ws"), {"silent"}, {}, ignored.callbacks());
  REQUIRE(dropped.waitFor(1));
  REQUIRE(ignored.waitFor(1));
  d->close(1000, "");
  i->close(1000, "");
  REQUIRE(dropped.waitFor(2));
  // After the five seconds a close waits for its answer.
  REQUIRE(ignored.waitFor(2, 10s));
  CHECK(dropped.seen() == std::vector<std::string>{"open ", "close 1006 "});
  CHECK(ignored.seen() == std::vector<std::string>{"open ", "close 1006 "});
}

TEST_CASE("a WebSocket over libcurl answers the server's close after the frame it is sending, and closes with the server's code") {
  TestServer server;
  SocketRecorder r;
  auto network = ngn::makeCurlNetwork();
  auto c = network.webSockets->connect(server.ws("/ws"), {}, {}, r.callbacks());
  REQUIRE(r.waitFor(1));
  // The server reads nothing for a moment, then closes and reads on until this side's close frame.
  // The 16 MB message is still going when the server's close comes, and this side's close is
  // queued behind it.
  c->sendText("close-later");
  c->sendBinary(std::string(16 * 1024 * 1024, 'x'));
  c->close(1000, "");
  REQUIRE(r.waitFor(2));
  CHECK(r.seen() == std::vector<std::string>{"open ", "close 4000 bye"});
  CHECK(serverLog(server, *network.http) == "[\"close 1000\"]");
}

TEST_CASE("a WebSocket over libcurl that keeps receiving leaves the thread to other requests") {
  TestServer server;
  Recorder text;
  auto received = std::make_shared<std::atomic<int>>(0);
  auto atComplete = std::make_shared<std::atomic<int>>(-1);
  auto slow = std::make_shared<std::atomic<bool>>(true);
  auto network = ngn::makeCurlNetwork();
  // A millisecond a message, so the 2000 the server sends at once take two seconds to take in.
  auto c = network.webSockets->connect(
      server.ws("/ws"), {}, {}, {.onText = [received, slow](const std::string &) {
        if (*slow) {
          std::this_thread::sleep_for(1ms);
        }
        ++*received;
      }});
  c->sendText("flood");
  auto deadline = Clock::now() + 10s;
  while (*received == 0 && Clock::now() < deadline) {
    std::this_thread::sleep_for(1ms);
  }
  REQUIRE(received->load() > 0);
  auto callbacks = text.callbacks();
  callbacks.onComplete = [atComplete, received, done = callbacks.onComplete](const std::string &e, bool t) {
    *atComplete = received->load();
    done(e, t);
  };
  network.http->send({.url = server.url("/text")}, std::move(callbacks));
  REQUIRE(text.waitForComplete());
  *slow = false;
  CHECK(text.body == "hello");
  // Done while messages were still coming in.
  CHECK(atComplete->load() < 2000);
}

TEST_CASE("the CA certificates are OpenSSL's variables when set, else the first bundle or directory a distribution keeps") {
  std::map<std::string, std::string> env;
  std::set<std::string> files, directories;
  CaProbe probe{
      .env = [&](const char *name) -> std::optional<std::string> {
        auto it = env.find(name);
        return it == env.end() ? std::nullopt : std::optional<std::string>(it->second);
      },
      .isFile = [&](const std::string &path) { return files.count(path) > 0; },
      .isDirectory = [&](const std::string &path) { return directories.count(path) > 0; },
  };
  auto found = [&] {
    auto ca = ngn::findCaCertificates(probe);
    return ca.file + "|" + ca.directory;
  };

  CHECK(found() == "|");
  directories = {"/etc/pki/tls/certs", "/etc/ssl/certs"};
  CHECK(found() == "|/etc/ssl/certs");
  files = {"/etc/ssl/ca-bundle.pem", "/etc/pki/tls/certs/ca-bundle.crt"};
  CHECK(found() == "/etc/pki/tls/certs/ca-bundle.crt|");
  files.insert("/etc/ssl/certs/ca-certificates.crt");
  CHECK(found() == "/etc/ssl/certs/ca-certificates.crt|");
  env["SSL_CERT_DIR"] = "/opt/certs";
  CHECK(found() == "|/opt/certs");
  env["SSL_CERT_FILE"] = "/opt/bundle.pem";
  CHECK(found() == "/opt/bundle.pem|/opt/certs");
  // An empty variable is unset.
  env = {{"SSL_CERT_FILE", ""}};
  CHECK(found() == "/etc/ssl/certs/ca-certificates.crt|");
}
