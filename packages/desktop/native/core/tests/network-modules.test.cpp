#include "fake-network.h"
#include "fake-system.h"
#include "ngn/core-modules.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <filesystem>
#include <fstream>

using folly::dynamic;
using ngn::testing::FakeHttp;
using ngn::testing::FakeWebSockets;

namespace {

struct Fixture {
  std::shared_ptr<FakeHttp> http = std::make_shared<FakeHttp>();
  std::shared_ptr<FakeWebSockets> sockets = std::make_shared<FakeWebSockets>();
  std::shared_ptr<ngn::BlobStore> blobs = std::make_shared<ngn::BlobStore>();
  ngn::CoreModuleServices services{.http = http, .webSockets = sockets, .blobs = blobs};
  std::vector<std::string> events;

  std::shared_ptr<ngn::NativeModule> make(std::shared_ptr<ngn::NativeModule> module) {
    module->setEmitter([this](const std::string &e, dynamic body) {
      folly::json::serialization_opts sorted;
      sorted.sort_keys = true;
      events.push_back(e + " " + folly::json::serialize(body, sorted));
    });
    return module;
  }

  int send(ngn::NativeModule &networking, dynamic query) {
    int id = -1;
    networking.callWithCallbacks(
        "sendRequest", dynamic::array(query, nullptr), {[&](dynamic a) { id = static_cast<int>(a[0].asInt()); }});
    return id;
  }
};

dynamic query(dynamic overrides) {
  dynamic q = dynamic::object("method", "GET")("url", "https://example.com/a")("data", dynamic::object())(
      "headers", dynamic::object())("responseType", "text")("incrementalUpdates", false)("timeout", 0)("withCredentials", true);
  for (auto &[k, v] : overrides.items()) {
    q[k] = v;
  }
  return q;
}

} // namespace

TEST_CASE("base64 goes both ways, and refuses what is not base64") {
  for (std::string bytes : {std::string(""), std::string("f"), std::string("fo"), std::string("foo"), std::string("\x00\xff\x10", 3)}) {
    CHECK(ngn::base64Decode(ngn::base64Encode(bytes)) == bytes);
  }
  CHECK(ngn::base64Encode("hello") == "aGVsbG8=");
  CHECK(ngn::base64Decode("aGVs\nbG8=") == "hello");
  CHECK_FALSE(ngn::base64Decode("a*b"));
}

TEST_CASE("UTF-8 chunks never split a character") {
  ngn::Utf8Chunker chunker;
  std::string euro = "\xE2\x82\xAC";  // three bytes
  CHECK(chunker.push("a" + euro.substr(0, 1)) == "a");
  CHECK(chunker.push(euro.substr(1, 1)) == "");
  CHECK(chunker.push(euro.substr(2) + "b") == euro + "b");
  CHECK(chunker.push("c\xC3") == "c");
  CHECK(chunker.finish() == "\xC3");
}

TEST_CASE("a request goes out with its method, headers, body and timeout, and its response comes back in order") {
  Fixture f;
  auto networking = f.make(ngn::makeNetworking(f.services));
  int id = f.send(
      *networking,
      query(dynamic::object("method", "POST")("data", dynamic::object("string", "{\"a\":1}"))(
          "headers", dynamic::object("Content-Type", "application/json"))("timeout", 5000)("withCredentials", false)));
  CHECK(id == 1);
  REQUIRE(f.http->sent.size() == 1);
  auto &sent = *f.http->sent[0];
  CHECK(sent.request.method == "POST");
  CHECK(sent.request.body == "{\"a\":1}");
  CHECK(sent.request.headers == ngn::Headers{{"Content-Type", "application/json"}});
  CHECK(sent.request.timeoutMs == 5000);
  CHECK_FALSE(sent.request.withCredentials);

  sent.callbacks.onUploadProgress(7, 7);
  sent.callbacks.onResponse({.status = 201, .headers = {{"Set-Cookie", "a=1"}, {"Set-Cookie", "b=2"}}, .url = "https://example.com/b"});
  sent.callbacks.onData("o", 2);
  sent.callbacks.onData("k", 2);
  sent.callbacks.onComplete("", false);
  CHECK(f.events == std::vector<std::string>{
                        "didSendNetworkData [1,7,7]",
                        R"(didReceiveNetworkResponse [1,201,{"Set-Cookie":"a=1, b=2"},"https://example.com/b"])",
                        R"(didReceiveNetworkData [1,"ok"])",
                        "didCompleteNetworkResponse [1,null,false]",
                    });
}

TEST_CASE("a text response with incremental updates streams each chunk as it arrives") {
  Fixture f;
  auto networking = f.make(ngn::makeNetworking(f.services));
  f.send(*networking, query(dynamic::object("incrementalUpdates", true)));
  auto &cb = f.http->sent[0]->callbacks;
  cb.onResponse({.status = 200});
  cb.onData("data: 1\n", -1);
  cb.onData("data: 2\n", -1);
  cb.onComplete("", false);
  CHECK(f.events == std::vector<std::string>{
                        R"(didReceiveNetworkResponse [1,200,{},""])",
                        R"(didReceiveNetworkIncrementalData [1,"data: 1\n",8,-1])",
                        R"(didReceiveNetworkIncrementalData [1,"data: 2\n",16,-1])",
                        "didCompleteNetworkResponse [1,null,false]",
                    });
}

TEST_CASE("a base64 response reports download progress and arrives encoded; a blob response arrives as a blob") {
  Fixture f;
  auto networking = f.make(ngn::makeNetworking(f.services));
  f.send(*networking, query(dynamic::object("responseType", "base64")("incrementalUpdates", true)));
  auto &cb = f.http->sent[0]->callbacks;
  cb.onData("hel", 5);
  cb.onData("lo", 5);
  cb.onComplete("", false);
  CHECK(f.events == std::vector<std::string>{
                        "didReceiveNetworkDataProgress [1,3,5]",
                        "didReceiveNetworkDataProgress [1,5,5]",
                        R"(didReceiveNetworkData [1,"aGVsbG8="])",
                        "didCompleteNetworkResponse [1,null,false]",
                    });

  f.events.clear();
  f.send(*networking, query(dynamic::object("responseType", "blob")));
  auto &blobCb = f.http->sent[1]->callbacks;
  blobCb.onResponse({.status = 200, .headers = {{"content-type", "image/png"}}});
  blobCb.onData("PNG", 3);
  blobCb.onComplete("", false);
  auto data = folly::parseJson(f.events[1].substr(f.events[1].find(' ') + 1))[1];
  CHECK(data["size"] == 3);
  CHECK(data["type"] == "image/png");
  CHECK(f.blobs->resolve(data) == "PNG");
}

TEST_CASE("a failed or timed-out request completes with its error") {
  Fixture f;
  auto networking = f.make(ngn::makeNetworking(f.services));
  f.send(*networking, query(dynamic::object()));
  f.http->sent[0]->callbacks.onComplete("The request timed out.", true);
  CHECK(f.events == std::vector<std::string>{R"(didCompleteNetworkResponse [1,"The request timed out.",true])"});
}

TEST_CASE("abortRequest cancels the task, and clearCookies empties the cookie store") {
  Fixture f;
  auto networking = f.make(ngn::makeNetworking(f.services));
  int id = f.send(*networking, query(dynamic::object()));
  networking->call("abortRequest", dynamic::array(id));
  CHECK(f.http->sent[0]->cancelled);

  dynamic cleared;
  networking->callWithCallbacks("clearCookies", dynamic::array(nullptr), {[&](dynamic a) { cleared = a; }});
  CHECK(f.http->cookieClears == 1);
  CHECK(cleared == dynamic::array(true));
}

TEST_CASE("form data goes out as multipart, with the content type and a part per field") {
  ngn::BlobStore blobs;
  auto dir = std::filesystem::temp_directory_path() / "ngn-form-test";
  std::filesystem::create_directories(dir);
  {
    std::ofstream(dir / "photo.jpg") << "JPEG";
  }
  auto body = ngn::requestBody(
      dynamic::object(
          "formData",
          dynamic::array(
              dynamic::object("fieldName", "title")("string", "Hello"),
              dynamic::object("fieldName", "photo")("uri", "file://" + (dir / "photo.jpg").string())("type", "image/jpeg"))),
      blobs,
      "XYZ");
  std::filesystem::remove_all(dir);
  CHECK(body.error.empty());
  CHECK(body.contentType == "multipart/form-data; boundary=XYZ");
  CHECK(body.bytes ==
        "--XYZ\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nHello\r\n"
        "--XYZ\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\nJPEG\r\n"
        "--XYZ--\r\n");
}

TEST_CASE("a base64 or blob body is sent as its bytes, and a released blob fails the request") {
  Fixture f;
  CHECK(ngn::requestBody(dynamic::object("base64", "aGk="), *f.blobs, "b").bytes == "hi");
  auto id = f.blobs->store("blob bytes");
  auto blob = ngn::requestBody(dynamic::object("blob", dynamic::object("blobId", id)("offset", 5)("size", 5)("type", "text/plain")), *f.blobs, "b");
  CHECK(blob.bytes == "bytes");
  CHECK(blob.contentType == "text/plain");

  auto networking = f.make(ngn::makeNetworking(f.services));
  f.send(*networking, query(dynamic::object("data", dynamic::object("blob", dynamic::object("blobId", "gone")))));
  CHECK(f.http->sent.empty());
  CHECK(f.events == std::vector<std::string>{R"(didCompleteNetworkResponse [1,"The request body's blob has been released.",false])"});
}

TEST_CASE("a WebSocket connects with its protocols and headers, and its messages, close and failure reach JavaScript") {
  Fixture f;
  auto ws = f.make(ngn::makeWebSocket(f.services));
  ws->call(
      "connect",
      dynamic::array("wss://echo.example/", dynamic::array("chat"), dynamic::object("headers", dynamic::object("Origin", "x")), 7));
  REQUIRE(f.sockets->connections.size() == 1);
  auto c = f.sockets->connections[0];
  CHECK(c->url == "wss://echo.example/");
  CHECK(c->protocols == std::vector<std::string>{"chat"});
  CHECK(c->headers == ngn::Headers{{"Origin", "x"}});

  c->callbacks.onOpen("chat");
  ws->call("send", dynamic::array("hi", 7));
  ws->call("sendBinary", dynamic::array("AAE=", 7));
  ws->call("ping", dynamic::array(7));
  c->callbacks.onText("yo");
  c->callbacks.onBinary(std::string("\x00\x01", 2));
  ws->call("close", dynamic::array(1000, "bye", 7));
  c->callbacks.onClose(1000, "bye");
  CHECK(c->log == std::vector<std::string>{"text hi", std::string("binary \x00\x01", 9), "ping", "close 1000 bye"});
  CHECK(f.events == std::vector<std::string>{
                        R"(websocketOpen {"id":7,"protocol":"chat"})",
                        R"(websocketMessage {"data":"yo","id":7,"type":"text"})",
                        R"(websocketMessage {"data":"AAE=","id":7,"type":"binary"})",
                        R"(websocketClosed {"code":1000,"id":7,"reason":"bye"})",
                    });

  ws->call("connect", dynamic::array("ws://nowhere/", nullptr, dynamic::object(), 8));
  f.sockets->connections[1]->callbacks.onError("Could not connect to the server.");
  CHECK(f.events.back() == R"(websocketFailed {"id":8,"message":"Could not connect to the server."})");
}

TEST_CASE("with a blob handler, binary messages arrive as blobs, and blobs go out over the socket") {
  Fixture f;
  auto ws = f.make(ngn::makeWebSocket(f.services));
  auto blob = f.make(ngn::makeBlobModule(f.services));
  ws->call("connect", dynamic::array("ws://h/", dynamic::array(), dynamic::object(), 3));
  auto c = f.sockets->connections[0];
  blob->call("addWebSocketHandler", dynamic::array(3));
  c->callbacks.onBinary("abc");
  auto message = folly::parseJson(f.events.back().substr(f.events.back().find(' ') + 1));
  CHECK(message["type"] == "blob");
  CHECK(f.blobs->resolve(message["data"]) == "abc");

  blob->call("sendOverSocket", dynamic::array(message["data"], 3));
  CHECK(c->log.back() == "binary abc");

  blob->call("removeWebSocketHandler", dynamic::array(3));
  c->callbacks.onBinary("abc");
  CHECK(folly::parseJson(f.events.back().substr(f.events.back().find(' ') + 1))["type"] == "binary");
}

TEST_CASE("Blob builds from parts and releases, and FileReader reads it as text or a data URL") {
  Fixture f;
  auto blob = ngn::makeBlobModule(f.services);
  CHECK(blob->call("getConstants")["BLOB_URI_SCHEME"] == "blob");
  auto first = f.blobs->store("world");
  blob->call(
      "createFromParts",
      dynamic::array(
          dynamic::array(
              dynamic::object("type", "string")("data", "hello "),
              dynamic::object("type", "blob")("data", dynamic::object("blobId", first)("offset", 0)("size", 5))),
          "joined"));
  auto reader = ngn::makeFileReader(f.services);
  std::string text, url, rejected;
  reader->callWithPromise(
      "readAsText", dynamic::array(dynamic::object("blobId", "joined")("offset", 0)("size", 11), "utf-8"),
      {[&](dynamic v) { text = v.asString(); }, nullptr});
  reader->callWithPromise(
      "readAsDataURL", dynamic::array(dynamic::object("blobId", "joined")("offset", 6)("size", 5)("type", "text/plain")),
      {[&](dynamic v) { url = v.asString(); }, nullptr});
  CHECK(text == "hello world");
  CHECK(url == "data:text/plain;base64,d29ybGQ=");

  blob->call("release", dynamic::array("joined"));
  reader->callWithPromise("readAsText", dynamic::array(dynamic::object("blobId", "joined"), "utf-8"), {nullptr, [&](const std::string &m) { rejected = m; }});
  CHECK(rejected == "The blob has been released.");
}

TEST_CASE("a module destroyed with requests and sockets open cancels and closes them") {
  Fixture f;
  auto networking = f.make(ngn::makeNetworking(f.services));
  f.send(*networking, query(dynamic::object()));
  auto ws = f.make(ngn::makeWebSocket(f.services));
  ws->call("connect", dynamic::array("ws://h/", dynamic::array(), dynamic::object(), 1));
  auto c = f.sockets->connections[0];
  networking.reset();
  ws.reset();
  CHECK(f.http->sent[0]->cancelled);
  CHECK(c->log == std::vector<std::string>{"close 1001 "});
  // A late callback from the OS after the module is gone goes nowhere.
  f.http->sent[0]->callbacks.onComplete("", false);
  c->callbacks.onText("late");
  CHECK(f.events.empty());
}

TEST_CASE("ImageLoader measures an image it fetches, with headers, and rejects what is not one") {
  Fixture f;
  auto system = std::make_shared<ngn::testing::FakeSystem>();
  f.services.system = system;
  auto loader = ngn::makeImageLoader(f.services);
  std::string out;
  ngn::JsPromise promise{[&](dynamic v) { out = folly::toJson(v); }, [&](const std::string &m) { out = "rejected " + m; }};

  loader->callWithPromise("getSize", dynamic::array("https://img/a.png"), promise);
  auto &a = f.http->sent[0]->callbacks;
  a.onResponse({.status = 200});
  a.onData("IMG 64x", 7);
  a.onData("32", 9);
  a.onComplete("", false);
  CHECK(out == "[64,32]");

  loader->callWithPromise("getSizeWithHeaders", dynamic::array("https://img/b.png", dynamic::object("Authorization", "x")), promise);
  CHECK(f.http->sent[1]->request.headers == ngn::Headers{{"Authorization", "x"}});
  f.http->sent[1]->callbacks.onData("IMG 3x4", 7);
  f.http->sent[1]->callbacks.onComplete("", false);
  CHECK(folly::parseJson(out) == dynamic::object("width", 3)("height", 4));

  loader->callWithPromise("prefetchImage", dynamic::array("https://img/c.txt"), promise);
  f.http->sent[2]->callbacks.onData("hello", 5);
  f.http->sent[2]->callbacks.onComplete("", false);
  CHECK(out == "rejected Not an image: https://img/c.txt");

  loader->callWithPromise("getSize", dynamic::array("https://img/missing.png"), promise);
  f.http->sent[3]->callbacks.onResponse({.status = 404});
  f.http->sent[3]->callbacks.onData("IMG 1x1", 7);
  f.http->sent[3]->callbacks.onComplete("", false);
  CHECK(out == "rejected HTTP 404 for https://img/missing.png");

  loader->callWithPromise("queryCache", dynamic::array(dynamic::array("https://img/a.png")), promise);
  CHECK(out == "{}");
}
