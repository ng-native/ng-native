#include "fake-network.h"
#include "ngn/bytes.h"
#include "ngn/native-module.h"
#include "ngn/updates.h"

#include <doctest/doctest.h>
#include <folly/json.h>

#include <fstream>
#include <sstream>

using folly::dynamic;
using ngn::testing::FakeHttp;

namespace {

namespace fs = std::filesystem;

// A stand-in for the OS's crypto: the "digest" names the bytes, and a signature is good when it
// is "signed " and the data, by the certificate "CERT".
struct FakeCrypto final : ngn::UpdateCrypto {
  std::string sha256(const std::string &bytes) override {
    return "digest of " + bytes;
  }
  bool verifyRsaSha256(const std::string &certificate, const std::string &data, const std::string &signature) override {
    return certificate == "CERT" && signature == "signed " + data;
  }
};

std::string hashOf(const std::string &bytes) {
  return ngn::base64Url(FakeCrypto().sha256(bytes));
}

dynamic manifest(const std::string &id, const std::string &runtime = "1.0.0", const std::string &asset = "bundle v2") {
  return dynamic::object("id", id)("createdAt", "2026-11-14T00:00:00.000Z")("runtimeVersion", runtime)(
      "launchAsset",
      dynamic::object("key", "bundle")("contentType", "application/javascript")("url", "https://u.example/" + id + ".js")(
          "hash", hashOf(asset)))("assets", dynamic::array())("metadata", dynamic::object())("extra", dynamic::object());
}

std::string read(const fs::path &file) {
  std::ifstream in(file, std::ios::binary);
  std::stringstream text;
  text << in.rdbuf();
  return text.str();
}

struct Fixture {
  fs::path dir;
  std::shared_ptr<FakeHttp> http = std::make_shared<FakeHttp>();
  std::shared_ptr<FakeCrypto> crypto = std::make_shared<FakeCrypto>();

  Fixture() {
    dir = fs::temp_directory_path() / ("ngn-updates-" + std::to_string(reinterpret_cast<uintptr_t>(this)));
    fs::remove_all(dir);
  }
  ~Fixture() {
    fs::remove_all(dir);
  }

  ngn::UpdatesConfig config(std::string certificate = "") const {
    return {
        .url = "https://u.example/manifest",
        .runtimeVersion = "1.0.0",
        .certificatePem = std::move(certificate),
        .directory = dir,
        .embeddedBundle = "/app/Contents/Resources/main.jsbundle",
    };
  }

  std::shared_ptr<ngn::UpdatesClient> client(std::string certificate = "") {
    return std::make_shared<ngn::UpdatesClient>(config(std::move(certificate)), http, crypto);
  }

  // Answers the last request sent.
  void answer(uint16_t status, ngn::Headers headers, const std::string &body) {
    auto sent = http->sent.back();
    sent->callbacks.onResponse({.status = status, .headers = std::move(headers), .url = sent->request.url});
    sent->callbacks.onData(body, static_cast<int64_t>(body.size()));
    sent->callbacks.onComplete("", false);
  }

  ngn::UpdatesClient::CheckResult check(ngn::UpdatesClient &client, ngn::Headers headers, const std::string &body) {
    std::optional<ngn::UpdatesClient::CheckResult> result;
    client.check([&](auto r) { result = std::move(r); });
    answer(200, std::move(headers), body);
    REQUIRE(result);
    return *result;
  }

  ngn::UpdatesClient::FetchResult fetch(ngn::UpdatesClient &client, const std::string &asset) {
    std::optional<ngn::UpdatesClient::FetchResult> result;
    client.fetch([&](auto r) { result = std::move(r); });
    answer(200, {{"content-type", "application/javascript"}}, asset);
    REQUIRE(result);
    return *result;
  }
};

const ngn::Headers kJson{{"content-type", "application/expo+json"}, {"expo-protocol-version", "1"}};

std::string header(const ngn::Headers &headers, const std::string &name) {
  for (const auto &[k, v] : headers) {
    if (k == name) {
      return v;
    }
  }
  return "";
}

// A multipart/mixed body with a manifest part (signed when `signature` is set) and an extensions part.
std::string multipart(const std::string &manifestJson, const std::string &signature = "", const std::string &directive = "") {
  std::string out;
  if (!manifestJson.empty()) {
    out += "--BOUNDARY\r\nContent-Disposition: form-data; name=\"manifest\"\r\nContent-Type: application/json\r\n";
    if (!signature.empty()) {
      out += "expo-signature: " + signature + "\r\n";
    }
    out += "\r\n" + manifestJson + "\r\n";
  }
  if (!directive.empty()) {
    out += "--BOUNDARY\r\nContent-Disposition: form-data; name=\"directive\"\r\nContent-Type: application/json\r\n\r\n" +
        directive + "\r\n";
  }
  out += "--BOUNDARY\r\nContent-Disposition: form-data; name=\"extensions\"\r\nContent-Type: application/json\r\n\r\n"
         "{\"assetRequestHeaders\":{}}\r\n--BOUNDARY--\r\n";
  return out;
}

const ngn::Headers kMultipart{{"Content-Type", "multipart/mixed; boundary=BOUNDARY"}, {"expo-protocol-version", "1"}};

} // namespace

TEST_CASE("a hash is base64url without padding, and a signature header is a dictionary of strings") {
  CHECK(ngn::base64Url(std::string("\xfb\xff\xfe", 3)) == "-__-");
  CHECK(ngn::base64Url("ab") == "YWI");
  auto parsed = ngn::parseSignatureHeader(R"(sig="c2ln", keyid="main", alg="rsa-v1_5-sha256")");
  REQUIRE(parsed);
  CHECK(parsed->at("sig") == "c2ln");
  CHECK(parsed->at("keyid") == "main");
  CHECK(parsed->at("alg") == "rsa-v1_5-sha256");
  CHECK_FALSE(ngn::parseSignatureHeader("sig=unquoted"));
}

TEST_CASE("a response is a manifest as JSON, or multipart parts with a signature or a directive") {
  auto json = folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a"));
  auto plain = ngn::parseUpdateResponse(kJson, json);
  REQUIRE(plain.manifest);
  CHECK(plain.manifest->id == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  CHECK(plain.manifest->runtimeVersion == "1.0.0");
  CHECK(plain.manifest->launchUrl == "https://u.example/1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a.js");
  CHECK(plain.manifest->launchHash == hashOf("bundle v2"));
  CHECK(plain.manifestBody == json);

  auto parts = ngn::parseUpdateResponse(kMultipart, multipart(json, R"(sig="c2ln", keyid="main")"));
  REQUIRE(parts.manifest);
  CHECK(parts.manifestBody == json);
  CHECK(parts.signature == R"(sig="c2ln", keyid="main")");

  auto none = ngn::parseUpdateResponse(kMultipart, multipart("", "", R"({"type":"noUpdateAvailable"})"));
  CHECK_FALSE(none.manifest);
  CHECK(none.directive == "noUpdateAvailable");

  CHECK_THROWS(ngn::parseUpdateResponse(kJson, "{\"id\":\"no launch asset\"}"));
  CHECK_THROWS(ngn::parseUpdateResponse({{"content-type", "multipart/mixed"}}, "no boundary"));
}

TEST_CASE("a check asks with the protocol's headers and offers a manifest for this runtime") {
  Fixture f;
  auto client = f.client();
  client->launch();
  std::optional<ngn::UpdatesClient::CheckResult> result;
  client->check([&](auto r) { result = std::move(r); });
  const auto &request = f.http->sent.back()->request;
  CHECK(request.url == "https://u.example/manifest");
  CHECK(header(request.headers, "expo-protocol-version") == "1");
  CHECK(header(request.headers, "expo-platform") == "macos");
  CHECK(header(request.headers, "expo-runtime-version") == "1.0.0");
  CHECK(header(request.headers, "accept") == "multipart/mixed,application/expo+json,application/json");
  // No code signing configured: no signature asked for.
  CHECK(header(request.headers, "expo-expect-signature").empty());
  f.answer(200, kJson, folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a")));
  REQUIRE(result);
  CHECK(result->isAvailable);
  CHECK(result->manifest["id"] == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");

  // Another runtime's update is not one for this build.
  CHECK_FALSE(f.check(*client, kJson, folly::toJson(manifest("2a1b0c9d-3e4f-4a5b-9c6d-7e8f9a0b1c2b", "2.0.0"))).isAvailable);
  // Nor is there one when the server says so.
  CHECK_FALSE(f.check(*client, kMultipart, multipart("", "", R"({"type":"noUpdateAvailable"})")).isAvailable);
  // A server error is an error, not "no update".
  std::optional<ngn::UpdatesClient::CheckResult> failed;
  client->check([&](auto r) { failed = std::move(r); });
  f.answer(500, {}, "down");
  REQUIRE(failed);
  CHECK_FALSE(failed->isAvailable);
  CHECK(failed->error.find("500") != std::string::npos);
}

TEST_CASE("with code signing on, only a manifest signed by the certificate is an update") {
  Fixture f;
  auto client = f.client("CERT");
  client->launch();
  std::optional<ngn::UpdatesClient::CheckResult> result;
  client->check([&](auto r) { result = std::move(r); });
  CHECK(header(f.http->sent.back()->request.headers, "expo-expect-signature") ==
        R"(sig, keyid="main", alg="rsa-v1_5-sha256")");
  auto json = folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a"));
  f.answer(200, kMultipart, multipart(json, "sig=\"" + ngn::base64Encode("signed " + json) + "\", keyid=\"main\""));
  REQUIRE(result);
  CHECK(result->isAvailable);
  CHECK(result->error.empty());

  // Signed over other bytes, unsigned, or by another key id: refused, with a reason.
  auto forged = f.check(*client, kMultipart, multipart(json, "sig=\"" + ngn::base64Encode("signed {}") + "\", keyid=\"main\""));
  CHECK_FALSE(forged.isAvailable);
  CHECK(forged.error.find("signature") != std::string::npos);
  CHECK_FALSE(f.check(*client, kMultipart, multipart(json)).isAvailable);
  auto otherKey = f.check(
      *client, kMultipart, multipart(json, "sig=\"" + ngn::base64Encode("signed " + json) + "\", keyid=\"other\""));
  CHECK_FALSE(otherKey.isAvailable);
}

TEST_CASE("a fetch keeps the launch asset only when its hash is the manifest's, and the next launch runs it") {
  Fixture f;
  auto client = f.client();
  CHECK(client->launch() == "/app/Contents/Resources/main.jsbundle");
  REQUIRE(f.check(*client, kJson, folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a"))).isAvailable);

  // A corrupted download is refused and kept nowhere.
  auto corrupt = f.fetch(*client, "bundle v2, truncated");
  CHECK_FALSE(corrupt.isNew);
  CHECK(corrupt.error.find("hash") != std::string::npos);
  CHECK_FALSE(client->state().current);
  CHECK(f.http->sent.back()->request.url == "https://u.example/1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a.js");

  auto fetched = f.fetch(*client, "bundle v2");
  CHECK(fetched.isNew);
  CHECK(fetched.manifest["id"] == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  auto state = client->state();
  REQUIRE(state.current);
  CHECK(state.current->id == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  CHECK(read(f.dir / state.current->file) == "bundle v2");
  CHECK(client->bundleToRun() == (f.dir / state.current->file).string());

  // The running update is not offered again.
  auto next = f.client();
  CHECK(next->launch() == (f.dir / state.current->file).string());
  CHECK(next->running()->id == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  std::optional<ngn::UpdatesClient::CheckResult> again;
  next->check([&](auto r) { again = std::move(r); });
  CHECK(header(f.http->sent.back()->request.headers, "expo-current-update-id") == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  f.answer(200, kJson, folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a")));
  CHECK_FALSE(again->isAvailable);
}

TEST_CASE("a launch that crashes rolls back to the update before it, and that update is never offered again") {
  Fixture f;
  {
    auto client = f.client();
    client->launch();
    f.check(*client, kJson, folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a", "1.0.0", "bundle a")));
    REQUIRE(f.fetch(*client, "bundle a").isNew);
  }
  std::string bundleA;
  {
    // The first update launches and runs long enough.
    auto client = f.client();
    bundleA = client->launch();
    CHECK(client->running()->id == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
    client->markLaunchSucceeded();
    f.check(*client, kJson, folly::toJson(manifest("2a1b0c9d-3e4f-4a5b-9c6d-7e8f9a0b1c2b", "1.0.0", "bundle b")));
    REQUIRE(f.fetch(*client, "bundle b").isNew);
  }
  {
    // The second launches and the process dies before it is marked a success.
    auto client = f.client();
    CHECK(client->running() == std::nullopt);
    auto bundle = client->launch();
    CHECK(client->running()->id == "2a1b0c9d-3e4f-4a5b-9c6d-7e8f9a0b1c2b");
    CHECK(client->state().launching == "2a1b0c9d-3e4f-4a5b-9c6d-7e8f9a0b1c2b");
  }
  auto client = f.client();
  CHECK(client->launch() == bundleA);
  CHECK(client->running()->id == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  CHECK(client->state().failed == std::vector<std::string>{"2a1b0c9d-3e4f-4a5b-9c6d-7e8f9a0b1c2b"});
  CHECK_FALSE(f.check(*client, kJson, folly::toJson(manifest("2a1b0c9d-3e4f-4a5b-9c6d-7e8f9a0b1c2b", "1.0.0", "bundle b"))).isAvailable);

  // The first update crashes too: the embedded bundle.
  auto last = f.client();
  CHECK(last->launch() == "/app/Contents/Resources/main.jsbundle");
  CHECK_FALSE(last->running());
}

TEST_CASE("an update for another runtime version is not launched after the app is updated") {
  Fixture f;
  {
    auto client = f.client();
    client->launch();
    f.check(*client, kJson, folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a")));
    REQUIRE(f.fetch(*client, "bundle v2").isNew);
  }
  auto config = f.config();
  config.runtimeVersion = "2.0.0";
  ngn::UpdatesClient client(config, f.http, f.crypto);
  CHECK(client.launch() == "/app/Contents/Resources/main.jsbundle");
  CHECK_FALSE(client.running());
}

TEST_CASE("NgNativeUpdates answers what Updates calls, and is off in development") {
  Fixture f;
  auto client = f.client();
  client->launch();
  std::vector<std::string> reloaded;
  auto module = ngn::makeUpdatesModule(client, false, [&](const std::string &bundle, std::function<void(bool)> done) {
    reloaded.push_back(bundle);
    done(true);
  });
  CHECK(module->property("isEnabled") == dynamic(true));
  CHECK(module->property("runtimeVersion") == dynamic("1.0.0"));
  CHECK(module->property("updateId") == dynamic(nullptr));
  CHECK(module->property("isEmbeddedLaunch") == dynamic(true));

  std::optional<dynamic> checked;
  module->callWithPromise("checkForUpdateAsync", dynamic::array(), {.resolve = [&](dynamic v) { checked = v; }});
  f.answer(200, kJson, folly::toJson(manifest("1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a")));
  REQUIRE(checked);
  CHECK((*checked)["isAvailable"] == true);
  CHECK((*checked)["manifest"]["id"] == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");

  std::optional<dynamic> fetched;
  module->callWithPromise("fetchUpdateAsync", dynamic::array(), {.resolve = [&](dynamic v) { fetched = v; }});
  f.answer(200, {}, "bundle v2");
  REQUIRE(fetched);
  CHECK((*fetched)["isNew"] == true);

  bool reloadedOk = false;
  module->callWithPromise("reloadAsync", dynamic::array(), {.resolve = [&](dynamic) { reloadedOk = true; }});
  CHECK(reloadedOk);
  CHECK(reloaded == std::vector<std::string>{client->bundleToRun()});
  // The reload runs the fetched update, and marks its launch.
  CHECK(client->running()->id == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");
  CHECK(client->state().launching == "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a");

  auto dev = ngn::makeUpdatesModule(client, true, nullptr);
  CHECK(dev->property("isEnabled") == dynamic(false));
  std::optional<std::string> refused;
  dev->callWithPromise("checkForUpdateAsync", dynamic::array(), {.reject = [&](const std::string &e) { refused = e; }});
  REQUIRE(refused);
  CHECK(refused->find("development") != std::string::npos);
}

namespace {

struct FakeAppUpdater final : ngn::AppUpdater {
  int checks{0};
  std::function<void(bool)> listener;
  bool found{false};
  void check() override {
    checks++;
  }
  bool updateAvailable() override {
    return found;
  }
  void onUpdateAvailable(std::function<void(bool)> fn) override {
    listener = std::move(fn);
  }
};

} // namespace

TEST_CASE("the whole-app updater is Sparkle's where the build has it, and absent elsewhere") {
  Fixture f;
  auto client = f.client();
  auto sparkle = std::make_shared<FakeAppUpdater>();
  auto module = ngn::makeUpdatesModule(client, false, nullptr, sparkle);
  std::vector<std::string> events;
  module->setEmitter([&](const std::string &event, dynamic body) { events.push_back(event + " " + folly::toJson(body)); });
  CHECK(module->property("isAppUpdaterAvailable") == dynamic(true));
  CHECK(module->call("isAppUpdateAvailable") == dynamic(false));

  std::optional<dynamic> shown;
  module->callWithPromise("checkForAppUpdateAsync", dynamic::array(), {.resolve = [&](dynamic v) { shown = v; }});
  CHECK(shown == dynamic(true));
  CHECK(sparkle->checks == 1);

  // Sparkle finds one in the background: JavaScript hears it, and asks the same.
  sparkle->found = true;
  sparkle->listener(true);
  CHECK(events == std::vector<std::string>{R"(appUpdateAvailable {"available":true})"});
  CHECK(module->call("isAppUpdateAvailable") == dynamic(true));

  // An app or mas build, or development: no updater, and the calls are inert.
  auto none = ngn::makeUpdatesModule(client, false, nullptr, nullptr);
  CHECK(none->property("isAppUpdaterAvailable") == dynamic(false));
  CHECK(none->call("isAppUpdateAvailable") == dynamic(false));
  std::optional<dynamic> inert;
  none->callWithPromise("checkForAppUpdateAsync", dynamic::array(), {.resolve = [&](dynamic v) { inert = v; }});
  CHECK(inert == dynamic(false));
}

namespace {
const std::string kIdA = "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a";

void overwrite(const fs::path &file, const std::string &text) {
  std::ofstream(file, std::ios::binary | std::ios::trunc) << text;
}
} // namespace

TEST_CASE("a manifest whose id is not a UUID is never an update, since the id names its folder") {
  Fixture f;
  auto client = f.client();
  client->launch();
  for (const char *id : {"../../outside", "aaa", "1f0e0a9c-2d3b-4c5d-8e6f-7a8b9c0d1e2a/..", ""}) {
    CAPTURE(id);
    auto result = f.check(*client, kJson, folly::toJson(manifest(id)));
    CHECK_FALSE(result.isAvailable);
    CHECK(result.error.find("UUID") != std::string::npos);
  }
}

TEST_CASE("a launch hashes the kept update again, and runs the embedded bundle when it changed on disk") {
  Fixture f;
  {
    auto client = f.client();
    client->launch();
    REQUIRE(f.check(*client, kJson, folly::toJson(manifest(kIdA))).isAvailable);
    REQUIRE(f.fetch(*client, "bundle v2").isNew);
  }
  {
    auto client = f.client();
    CHECK(client->launch() == (f.dir / kIdA / "launch-asset").string());
    client->markLaunchSucceeded();
  }
  overwrite(f.dir / kIdA / "launch-asset", "tampered bundle");
  auto client = f.client();
  CHECK(client->launch() == "/app/Contents/Resources/main.jsbundle");
  CHECK_FALSE(client->running());
}

TEST_CASE("a launch runs only <uuid>/launch-asset, whatever the state file names") {
  Fixture f;
  {
    auto client = f.client();
    client->launch();
    REQUIRE(f.check(*client, kJson, folly::toJson(manifest(kIdA))).isAvailable);
    REQUIRE(f.fetch(*client, "bundle v2").isNew);
  }
  fs::create_directories(f.dir / "elsewhere");
  overwrite(f.dir / "elsewhere/evil.js", "bundle v2");
  auto state = read(f.dir / "state.json");
  auto at = state.find(kIdA + "/launch-asset");
  REQUIRE(at != std::string::npos);
  state.replace(at, (kIdA + "/launch-asset").size(), "elsewhere/evil.js");
  overwrite(f.dir / "state.json", state);
  // Not marked as launching: only the file it names keeps it from running.
  CHECK(state.find("\"launching\": \"\"") != std::string::npos);
  CHECK(f.client()->launch() == "/app/Contents/Resources/main.jsbundle");
}

TEST_CASE("with code signing on, a launch checks the kept manifest's signature and that it names the kept asset") {
  Fixture f;
  auto signedFetch = [&](ngn::UpdatesClient &client) {
    auto json = folly::toJson(manifest(kIdA));
    REQUIRE(f.check(client, kMultipart, multipart(json, "sig=\"" + ngn::base64Encode("signed " + json) + "\", keyid=\"main\""))
                .isAvailable);
    REQUIRE(f.fetch(client, "bundle v2").isNew);
  };
  {
    auto client = f.client("CERT");
    client->launch();
    signedFetch(*client);
  }
  {
    auto client = f.client("CERT");
    CHECK(client->launch() == (f.dir / kIdA / "launch-asset").string());
    // Ran long enough: the next launch does not take it for a crash.
    client->markLaunchSucceeded();
  }

  // The asset and the kept manifest's hash both rewritten to match: the signature no longer does.
  overwrite(f.dir / kIdA / "launch-asset", "evil bundle");
  auto evil = manifest(kIdA);
  evil["launchAsset"]["hash"] = hashOf("evil bundle");
  overwrite(f.dir / kIdA / "manifest.json", folly::toJson(evil));
  CHECK(f.client("CERT")->launch() == "/app/Contents/Resources/main.jsbundle");
}

TEST_CASE("a success mark counts only for the launch it was made for, not one a reload began since") {
  Fixture f;
  {
    auto client = f.client();
    client->launch();
    REQUIRE(f.check(*client, kJson, folly::toJson(manifest(kIdA))).isAvailable);
    REQUIRE(f.fetch(*client, "bundle v2").isNew);
  }
  auto client = f.client();
  client->launch();
  auto first = client->launchGeneration();
  REQUIRE(client->state().launching == kIdA);

  // A reload into the same update starts a new launch: the first launch's timer firing now says
  // nothing about it.
  client->beginReload();
  CHECK(client->launchGeneration() != first);
  client->markLaunchSucceeded(first);
  CHECK(client->state().launching == kIdA);
  client->markLaunchSucceeded(client->launchGeneration());
  CHECK(client->state().launching.empty());
}
