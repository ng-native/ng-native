#include "ngn/updates.h"

#include "ngn/bytes.h"
#include "ngn/native-module.h"

#include <folly/json.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <stdexcept>

namespace ngn {

namespace fs = std::filesystem;

namespace {

std::string lower(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return std::tolower(c); });
  return text;
}

std::string trim(const std::string &text) {
  size_t start = text.find_first_not_of(" \t\r\n");
  if (start == std::string::npos) {
    return "";
  }
  return text.substr(start, text.find_last_not_of(" \t\r\n") - start + 1);
}

std::string headerOf(const Headers &headers, const std::string &name) {
  for (const auto &[key, value] : headers) {
    if (lower(key) == name) {
      return value;
    }
  }
  return "";
}

// A parameter of a header value: `boundary` of `multipart/mixed; boundary=abc`.
std::string parameterOf(const std::string &value, const std::string &name) {
  std::stringstream in(value);
  std::string piece;
  std::getline(in, piece, ';');
  while (std::getline(in, piece, ';')) {
    auto eq = piece.find('=');
    if (eq != std::string::npos && lower(trim(piece.substr(0, eq))) == name) {
      auto found = trim(piece.substr(eq + 1));
      if (found.size() >= 2 && found.front() == '"' && found.back() == '"') {
        found = found.substr(1, found.size() - 2);
      }
      return found;
    }
  }
  return "";
}

std::string mediaType(const std::string &contentType) {
  return lower(trim(contentType.substr(0, contentType.find(';'))));
}

// 8-4-4-4-12 hex digits: what the protocol's ids are, and all a folder name may be.
bool isUuid(const std::string &id) {
  if (id.size() != 36) {
    return false;
  }
  for (size_t i = 0; i < id.size(); i++) {
    bool dash = i == 8 || i == 13 || i == 18 || i == 23;
    if (dash ? id[i] != '-' : !std::isxdigit(static_cast<unsigned char>(id[i]))) {
      return false;
    }
  }
  return true;
}

UpdateManifest readManifest(const std::string &body) {
  folly::dynamic json;
  try {
    json = folly::parseJson(body);
  } catch (const std::exception &) {
    throw std::runtime_error("the manifest is not JSON");
  }
  auto text = [&](const folly::dynamic &object, const char *key) -> std::string {
    const auto *value = object.isObject() ? object.get_ptr(key) : nullptr;
    if (value == nullptr || !value->isString()) {
      throw std::runtime_error(std::string("the manifest has no ") + key);
    }
    return value->asString();
  };
  const auto *launch = json.isObject() ? json.get_ptr("launchAsset") : nullptr;
  if (launch == nullptr || !launch->isObject()) {
    throw std::runtime_error("the manifest has no launchAsset");
  }
  if (!isUuid(text(json, "id"))) {
    throw std::runtime_error("the manifest's id is not a UUID");
  }
  return UpdateManifest{
      .id = text(json, "id"),
      .createdAt = text(json, "createdAt"),
      .runtimeVersion = text(json, "runtimeVersion"),
      .launchUrl = text(*launch, "url"),
      .launchHash = text(*launch, "hash"),
      .raw = json,
  };
}

std::string readDirective(const std::string &body) {
  try {
    auto json = folly::parseJson(body);
    if (const auto *type = json.isObject() ? json.get_ptr("type") : nullptr; type != nullptr && type->isString()) {
      return type->asString();
    }
  } catch (const std::exception &) {
  }
  throw std::runtime_error("the directive is not a JSON object with a type");
}

struct Part {
  Headers headers;
  std::string body;
};

std::vector<Part> multipartParts(const std::string &body, const std::string &boundary) {
  std::vector<Part> parts;
  const std::string delimiter = "--" + boundary;
  size_t at = body.find(delimiter);
  while (at != std::string::npos) {
    at += delimiter.size();
    if (body.compare(at, 2, "--") == 0) {
      break;
    }
    at = body.find("\r\n", at);
    if (at == std::string::npos) {
      break;
    }
    at += 2;
    size_t next = body.find("\r\n" + delimiter, at);
    if (next == std::string::npos) {
      throw std::runtime_error("a multipart part does not end");
    }
    std::string raw = body.substr(at, next - at);
    size_t split = raw.find("\r\n\r\n");
    Part part;
    std::string head = split == std::string::npos ? raw : raw.substr(0, split);
    part.body = split == std::string::npos ? "" : raw.substr(split + 4);
    std::stringstream lines(head);
    std::string line;
    while (std::getline(lines, line)) {
      if (!line.empty() && line.back() == '\r') {
        line.pop_back();
      }
      if (auto colon = line.find(':'); colon != std::string::npos) {
        part.headers.emplace_back(trim(line.substr(0, colon)), trim(line.substr(colon + 1)));
      }
    }
    parts.push_back(std::move(part));
    at = next + 2;
  }
  return parts;
}

std::string readFile(const fs::path &file) {
  std::ifstream in(file, std::ios::binary);
  std::stringstream text;
  text << in.rdbuf();
  return text.str();
}

void writeFile(const fs::path &file, const std::string &bytes) {
  fs::create_directories(file.parent_path());
  auto temporary = file;
  temporary += ".partial";
  {
    std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    if (!out) {
      throw std::runtime_error("could not write " + file.string());
    }
  }
  fs::rename(temporary, file);
}

folly::dynamic toJson(const std::optional<LaunchState::Update> &update) {
  if (!update) {
    return nullptr;
  }
  return folly::dynamic::object("id", update->id)("createdAt", update->createdAt)("runtimeVersion", update->runtimeVersion)(
      "file", update->file);
}

std::optional<LaunchState::Update> updateFrom(const folly::dynamic &json) {
  if (!json.isObject()) {
    return std::nullopt;
  }
  auto text = [&](const char *key) {
    const auto *value = json.get_ptr(key);
    return value != nullptr && value->isString() ? value->asString() : std::string();
  };
  return LaunchState::Update{
      .id = text("id"), .createdAt = text("createdAt"), .runtimeVersion = text("runtimeVersion"), .file = text("file")};
}

// The response body and status of one request, gathered from its callbacks.
struct Download {
  uint16_t status{0};
  Headers headers;
  std::string body;
};

} // namespace

std::string base64Url(const std::string &bytes) {
  auto text = base64Encode(bytes);
  for (auto &c : text) {
    c = c == '+' ? '-' : c == '/' ? '_' : c;
  }
  while (!text.empty() && text.back() == '=') {
    text.pop_back();
  }
  return text;
}

std::optional<std::map<std::string, std::string>> parseSignatureHeader(const std::string &header) {
  std::map<std::string, std::string> out;
  size_t at = 0;
  while (at < header.size()) {
    while (at < header.size() && (header[at] == ' ' || header[at] == ',')) {
      at++;
    }
    if (at >= header.size()) {
      break;
    }
    auto eq = header.find('=', at);
    if (eq == std::string::npos || eq + 1 >= header.size() || header[eq + 1] != '"') {
      return std::nullopt;
    }
    auto key = trim(header.substr(at, eq - at));
    auto close = header.find('"', eq + 2);
    if (close == std::string::npos) {
      return std::nullopt;
    }
    out[key] = header.substr(eq + 2, close - eq - 2);
    at = close + 1;
  }
  return out;
}

UpdateResponse parseUpdateResponse(const Headers &headers, const std::string &body) {
  auto contentType = headerOf(headers, "content-type");
  UpdateResponse response;
  if (mediaType(contentType) == "multipart/mixed") {
    auto boundary = parameterOf(contentType, "boundary");
    if (boundary.empty()) {
      throw std::runtime_error("the multipart response has no boundary");
    }
    for (auto &part : multipartParts(body, boundary)) {
      auto name = parameterOf(headerOf(part.headers, "content-disposition"), "name");
      if (name == "manifest") {
        response.manifest = readManifest(part.body);
        response.manifestBody = std::move(part.body);
        response.signature = headerOf(part.headers, "expo-signature");
      } else if (name == "directive") {
        response.directive = readDirective(part.body);
      }
    }
    return response;
  }
  response.manifest = readManifest(body);
  response.manifestBody = body;
  response.signature = headerOf(headers, "expo-signature");
  return response;
}

UpdatesClient::UpdatesClient(UpdatesConfig config, std::shared_ptr<Http> http, std::shared_ptr<UpdateCrypto> crypto)
    : config_(std::move(config)), http_(std::move(http)), crypto_(std::move(crypto)) {}

LaunchState UpdatesClient::load() const {
  LaunchState state;
  auto file = config_.directory / "state.json";
  if (!fs::exists(file)) {
    return state;
  }
  try {
    auto json = folly::parseJson(readFile(file));
    state.current = updateFrom(json.getDefault("current"));
    state.previous = updateFrom(json.getDefault("previous"));
    for (const auto &id : json.getDefault("failed", folly::dynamic::array())) {
      if (id.isString()) {
        state.failed.push_back(id.asString());
      }
    }
    if (const auto *launching = json.get_ptr("launching"); launching != nullptr && launching->isString()) {
      state.launching = launching->asString();
    }
  } catch (const std::exception &) {
    // A state file that does not read is no state: the embedded bundle runs.
    return LaunchState{};
  }
  return state;
}

void UpdatesClient::save(const LaunchState &state) const {
  folly::dynamic failed = folly::dynamic::array();
  for (const auto &id : state.failed) {
    failed.push_back(id);
  }
  folly::dynamic json = folly::dynamic::object("current", toJson(state.current))("previous", toJson(state.previous))(
      "failed", failed)("launching", state.launching);
  writeFile(config_.directory / "state.json", folly::toPrettyJson(json));
}

std::string UpdatesClient::pathOf(const LaunchState::Update &update) const {
  return (config_.directory / update.file).string();
}

std::optional<std::string> UpdatesClient::signatureProblem(const std::string &body, const std::string &header) const {
  if (config_.certificatePem.empty()) {
    return std::nullopt;
  }
  auto signature = parseSignatureHeader(header);
  if (header.empty() || !signature || !signature->contains("sig")) {
    return "the manifest has no expo-signature, and the app requires one";
  }
  auto keyId = signature->contains("keyid") ? signature->at("keyid") : std::string("main");
  auto alg = signature->contains("alg") ? signature->at("alg") : config_.algorithm;
  auto bytes = base64Decode(signature->at("sig"));
  if (keyId != config_.keyId || alg != config_.algorithm || !bytes ||
      !crypto_->verifyRsaSha256(config_.certificatePem, body, *bytes)) {
    return "the manifest's signature does not verify against the app's certificate";
  }
  return std::nullopt;
}

bool UpdatesClient::usable(const LaunchState::Update &update, const LaunchState &state) const {
  // Only `<uuid>/launch-asset`, whatever the state file says.
  if (!isUuid(update.id) || update.file != update.id + "/launch-asset" || update.runtimeVersion != config_.runtimeVersion ||
      std::find(state.failed.begin(), state.failed.end(), update.id) != state.failed.end() || !fs::exists(pathOf(update))) {
    return false;
  }
  // The files may have changed since they were checked: the kept manifest must still be signed,
  // name this update, and hash to the asset.
  try {
    auto folder = config_.directory / update.id;
    auto body = readFile(folder / "manifest.json");
    auto manifest = readManifest(body);
    std::string signature = fs::exists(folder / "signature") ? readFile(folder / "signature") : "";
    return manifest.id == update.id && !signatureProblem(body, signature) &&
        base64Url(crypto_->sha256(readFile(pathOf(update)))) == manifest.launchHash;
  } catch (const std::exception &) {
    return false;
  }
}

std::string UpdatesClient::launch() {
  std::lock_guard lock(mutex_);
  running_.reset();
  if (!enabled()) {
    return config_.embeddedBundle;
  }
  auto state = load();
  if (!state.launching.empty()) {
    // The last launch never ran long enough: it crashed. Its update is never run again.
    if (std::find(state.failed.begin(), state.failed.end(), state.launching) == state.failed.end()) {
      state.failed.push_back(state.launching);
    }
    if (state.current && state.current->id == state.launching) {
      state.current = state.previous;
      state.previous.reset();
    }
    state.launching.clear();
  }
  if (state.current && !usable(*state.current, state)) {
    state.current.reset();
  }
  if (state.current) {
    running_ = state.current;
    state.launching = state.current->id;
  }
  save(state);
  return running_ ? pathOf(*running_) : config_.embeddedBundle;
}

void UpdatesClient::markLaunchSucceeded() {
  std::lock_guard lock(mutex_);
  if (!enabled()) {
    return;
  }
  auto state = load();
  if (!state.launching.empty() && running_ && state.launching == running_->id) {
    state.launching.clear();
    save(state);
  }
}

std::optional<LaunchState::Update> UpdatesClient::running() const {
  std::lock_guard lock(mutex_);
  return running_;
}

LaunchState UpdatesClient::state() const {
  std::lock_guard lock(mutex_);
  return load();
}

std::string UpdatesClient::bundleToRun() const {
  std::lock_guard lock(mutex_);
  auto state = load();
  return state.current && usable(*state.current, state) ? pathOf(*state.current) : config_.embeddedBundle;
}

std::string UpdatesClient::beginReload() {
  std::lock_guard lock(mutex_);
  auto state = load();
  running_.reset();
  state.launching.clear();
  if (state.current && usable(*state.current, state)) {
    running_ = state.current;
    state.launching = state.current->id;
  }
  save(state);
  return running_ ? pathOf(*running_) : config_.embeddedBundle;
}

void UpdatesClient::check(std::function<void(CheckResult)> done) {
  if (!enabled()) {
    done({.error = "updates are off: the app has no updates URL"});
    return;
  }
  HttpRequest request{.url = config_.url, .withCredentials = false};
  request.headers = {
      {"expo-protocol-version", "1"},
      {"expo-platform", config_.platform},
      {"expo-runtime-version", config_.runtimeVersion},
      {"accept", "multipart/mixed,application/expo+json,application/json"},
  };
  if (auto current = running()) {
    request.headers.emplace_back("expo-current-update-id", current->id);
  }
  if (!config_.certificatePem.empty()) {
    request.headers.emplace_back(
        "expo-expect-signature", "sig, keyid=\"" + config_.keyId + "\", alg=\"" + config_.algorithm + "\"");
  }
  auto download = std::make_shared<Download>();
  auto task = http_->send(
      std::move(request),
      {
          .onResponse =
              [download](const HttpResponse &response) {
                download->status = response.status;
                download->headers = response.headers;
              },
          .onData = [download](std::string chunk, int64_t) { download->body += chunk; },
          .onComplete =
              [this, download, done](const std::string &error, bool) {
                CheckResult result;
                if (!error.empty()) {
                  result.error = "the update server could not be reached: " + error;
                  done(std::move(result));
                  return;
                }
                if (download->status == 204) {
                  done(std::move(result));
                  return;
                }
                if (download->status != 200) {
                  result.error = "the update server answered " + std::to_string(download->status);
                  done(std::move(result));
                  return;
                }
                try {
                  auto response = parseUpdateResponse(download->headers, download->body);
                  auto state = this->state();
                  std::lock_guard lock(mutex_);
                  found_.reset();
                  foundRollBack_ = false;
                  if (response.directive == "rollBackToEmbedded") {
                    foundRollBack_ = running_.has_value() || state.current.has_value();
                    result.isAvailable = foundRollBack_;
                    result.isRollBackToEmbedded = foundRollBack_;
                  } else if (response.manifest) {
                    const auto &manifest = *response.manifest;
                    if (auto problem = signatureProblem(response.manifestBody, response.signature)) {
                      throw std::runtime_error(*problem);
                    }
                    bool failed = std::find(state.failed.begin(), state.failed.end(), manifest.id) != state.failed.end();
                    bool known = (running_ && running_->id == manifest.id) || (state.current && state.current->id == manifest.id);
                    if (manifest.runtimeVersion == config_.runtimeVersion && !failed && !known) {
                      found_ = manifest;
                      foundBody_ = response.manifestBody;
                      foundSignature_ = response.signature;
                      result.isAvailable = true;
                      result.manifest = manifest.raw;
                    }
                  }
                } catch (const std::exception &e) {
                  result = CheckResult{.error = e.what()};
                }
                done(std::move(result));
              },
      });
  std::lock_guard lock(mutex_);
  task_ = std::move(task);
}

void UpdatesClient::fetch(std::function<void(FetchResult)> done) {
  std::optional<UpdateManifest> found;
  std::string foundBody;
  std::string foundSignature;
  bool rollBack = false;
  {
    std::lock_guard lock(mutex_);
    found = found_;
    foundBody = foundBody_;
    foundSignature = foundSignature_;
    rollBack = foundRollBack_;
  }
  if (rollBack) {
    {
      std::lock_guard lock(mutex_);
      auto state = load();
      state.previous = state.current;
      state.current.reset();
      save(state);
      foundRollBack_ = false;
    }
    done({.isRollBackToEmbedded = true});
    return;
  }
  if (!found) {
    done({});
    return;
  }
  auto download = std::make_shared<Download>();
  auto task = http_->send(
      HttpRequest{.url = found->launchUrl, .withCredentials = false},
      {
          .onResponse = [download](const HttpResponse &response) { download->status = response.status; },
          .onData = [download](std::string chunk, int64_t) { download->body += chunk; },
          .onComplete =
              [this, download, found, foundBody, foundSignature, done](const std::string &error, bool) {
                FetchResult result;
                if (!error.empty() || download->status != 200) {
                  result.error = error.empty() ? "the launch asset's server answered " + std::to_string(download->status)
                                               : "the launch asset could not be downloaded: " + error;
                  done(std::move(result));
                  return;
                }
                if (base64Url(crypto_->sha256(download->body)) != found->launchHash) {
                  result.error = "the launch asset's hash is not the manifest's: it was not kept";
                  done(std::move(result));
                  return;
                }
                try {
                  std::lock_guard lock(mutex_);
                  LaunchState::Update update{
                      .id = found->id,
                      .createdAt = found->createdAt,
                      .runtimeVersion = found->runtimeVersion,
                      .file = found->id + "/launch-asset",
                  };
                  writeFile(config_.directory / update.file, download->body);
                  // What the next launch checks the asset against, signature and all.
                  writeFile(config_.directory / update.id / "manifest.json", foundBody);
                  writeFile(config_.directory / update.id / "signature", foundSignature);
                  auto state = load();
                  if (state.current && state.current->id != update.id) {
                    state.previous = state.current;
                  }
                  state.current = update;
                  save(state);
                  // Only the updates the state names, and the one running, are kept.
                  for (const auto &entry : fs::directory_iterator(config_.directory)) {
                    auto name = entry.path().filename().string();
                    bool keep = !entry.is_directory() || name == update.id || (state.previous && name == state.previous->id) ||
                        (running_ && name == running_->id);
                    if (!keep) {
                      fs::remove_all(entry.path());
                    }
                  }
                  found_.reset();
                  result.isNew = true;
                  result.manifest = found->raw;
                } catch (const std::exception &e) {
                  result.error = e.what();
                }
                done(std::move(result));
              },
      });
  std::lock_guard lock(mutex_);
  task_ = std::move(task);
}

std::shared_ptr<NativeModule> makeUpdatesModule(
    std::shared_ptr<UpdatesClient> client,
    bool development,
    std::function<void(const std::string &bundle, std::function<void(bool)> done)> reload,
    std::shared_ptr<AppUpdater> appUpdater) {
  // Where the updater's news goes: this module while it lives, which a reload replaces.
  struct Sink {
    std::mutex mutex;
    NativeModule *module{nullptr};
  };
  struct Updates : NativeModule {
    std::shared_ptr<Sink> sink = std::make_shared<Sink>();
    ~Updates() override {
      std::lock_guard lock(sink->mutex);
      sink->module = nullptr;
    }
    Updates(
        std::shared_ptr<UpdatesClient> client,
        bool development,
        std::function<void(const std::string &, std::function<void(bool)>)> reload,
        std::shared_ptr<AppUpdater> appUpdater)
        : NativeModule("NgNativeUpdates") {
      listeners();
      property("isAppUpdaterAvailable", [appUpdater] { return folly::dynamic(appUpdater != nullptr); });
      sync("isAppUpdateAvailable", [appUpdater](const folly::dynamic &) {
        return folly::dynamic(appUpdater != nullptr && appUpdater->updateAvailable());
      });
      promise("checkForAppUpdateAsync", [appUpdater](const folly::dynamic &, JsPromise p) {
        if (appUpdater) {
          appUpdater->check();
        }
        p.resolve(appUpdater != nullptr);
      });
      if (appUpdater) {
        sink->module = this;
        appUpdater->onUpdateAvailable([sink = sink](bool available) {
          std::lock_guard lock(sink->mutex);
          if (sink->module != nullptr) {
            static_cast<Updates *>(sink->module)->announce(available);
          }
        });
      }
      bool on = client->enabled() && !development;
      property("isEnabled", [on] { return folly::dynamic(on); });
      property("runtimeVersion", [client] { return folly::dynamic(client->config().runtimeVersion); });
      property("updateId", [client] {
        auto running = client->running();
        return running ? folly::dynamic(running->id) : folly::dynamic(nullptr);
      });
      property("isEmbeddedLaunch", [client] { return folly::dynamic(!client->running()); });
      auto refuse = [on, development](JsPromise &p) {
        if (on) {
          return false;
        }
        p.reject(development ? "Updates are off in development, where the bundle comes from the dev server."
                             : "Updates are off: the app has no updates URL (updates.url in app.json).");
        return true;
      };
      promise("checkForUpdateAsync", [client, refuse](const folly::dynamic &, JsPromise p) {
        if (refuse(p)) {
          return;
        }
        client->check([p](UpdatesClient::CheckResult r) {
          if (!r.error.empty()) {
            p.reject(r.error);
            return;
          }
          p.resolve(folly::dynamic::object("isAvailable", r.isAvailable)("isRollBackToEmbedded", r.isRollBackToEmbedded)(
              "manifest", r.manifest));
        });
      });
      promise("fetchUpdateAsync", [client, refuse](const folly::dynamic &, JsPromise p) {
        if (refuse(p)) {
          return;
        }
        client->fetch([p](UpdatesClient::FetchResult r) {
          if (!r.error.empty()) {
            p.reject(r.error);
            return;
          }
          p.resolve(folly::dynamic::object("isNew", r.isNew)("isRollBackToEmbedded", r.isRollBackToEmbedded)(
              "manifest", r.manifest));
        });
      });
      promise("reloadAsync", [client, refuse, reload](const folly::dynamic &, JsPromise p) {
        if (refuse(p)) {
          return;
        }
        if (!reload) {
          p.reject("This host cannot reload.");
          return;
        }
        // Resolved first: the reload tears down the runtime the promise belongs to. A bundle that
        // does not load is the host's to report.
        auto bundle = client->beginReload();
        p.resolve(nullptr);
        reload(bundle, [](bool) {});
      });
    }
    void announce(bool available) {
      emit("appUpdateAvailable", folly::dynamic::object("available", available));
    }
  };
  return std::make_shared<Updates>(std::move(client), development, std::move(reload), std::move(appUpdater));
}

} // namespace ngn
