// React Native's DevServerHelper (ReactCxxPlatform/react/devsupport/DevServerHelper.h), in place
// of the upstream DevServerHelper.cpp, which hard-codes `android` as the bundle's and the HMR
// client's platform and builds the bundle URL itself. Here the source path is the bundle URL the
// host was given, used as it is, and the HMR client is set up with that URL's platform and entry.
//
// The download also fails on an HTTP error status, so a compile error reports Metro's message
// instead of evaluating Metro's JSON error body as the bundle.
#include "ngn/dev-server.h"

#include <react/devsupport/DevServerHelper.h>

#include <fmt/format.h>
#include <glog/logging.h>
#include <jsinspector-modern/InspectorFlags.h>
#include <openssl/sha.h>

#include <array>
#include <iomanip>
#include <sstream>

namespace facebook::react {

namespace {

std::string sha256(const std::string &input) {
  std::array<unsigned char, SHA256_DIGEST_LENGTH> hash{};
  SHA256_CTX context;
  SHA256_Init(&context);
  SHA256_Update(&context, input.c_str(), input.size());
  SHA256_Final(hash.data(), &context);
  std::stringstream out;
  for (unsigned char byte : hash) {
    out << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
  }
  return out.str();
}

std::string urlEscape(const std::string &value) {
  std::string out;
  for (char c : value) {
    if (std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_' || c == '~' || c == '-') {
      out += c;
    }
  }
  return out;
}

} // namespace

DevServerHelper::DevServerHelper(
    std::string appId,
    std::string deviceName,
    std::string devServerHost,
    uint32_t devServerPort,
    const HttpClientFactory &httpClientFactory,
    JavaScriptModuleCallback javaScriptModuleCallback) noexcept
    : appId_(std::move(appId)),
      deviceName_(std::move(deviceName)),
      devServerHost_(std::move(devServerHost)),
      devServerPort_(devServerPort),
      httpClient_(httpClientFactory()),
      javaScriptModuleCallback_(std::move(javaScriptModuleCallback)) {
  deviceId_ = sha256(fmt::format("{}-{}", deviceName_, appId_));
}

std::future<std::string> DevServerHelper::downloadBundleResourceSync(
    const std::string &jsBundleUrl,
    DownloadProgressCallback &&downloadProgressCallback) {
  struct Download {
    std::promise<std::string> promise;
    uint16_t status{0};
    std::string body;
  };
  auto download = std::make_shared<Download>();
  auto progress = std::make_shared<DownloadProgressCallback>(std::move(downloadProgressCallback));
  http::NetworkCallbacks callbacks{
      .onResponse = [download](uint16_t status, const http::Headers &) { download->status = status; },
      .onBody = [download](std::unique_ptr<folly::IOBuf> body) { download->body = body->moveToFbString().toStdString(); },
      .onResponseComplete =
          [download, progress, jsBundleUrl](const std::string &error, bool timeout) {
            std::string message;
            if (!error.empty() || timeout) {
              message = error.empty() ? "timed out" : error;
            } else if (download->status >= 400) {
              message = fmt::format("HTTP {}: {}", download->status, download->body.substr(0, 2000));
            }
            if (message.empty()) {
              if (*progress) {
                (*progress)(DownloadProgressStatus::FINISHED);
              }
              download->promise.set_value(std::move(download->body));
              return;
            }
            if (*progress) {
              (*progress)(DownloadProgressStatus::FAILED);
            }
            LOG(ERROR) << "Could not load the bundle from " << jsBundleUrl << ": " << message;
            download->promise.set_exception(std::make_exception_ptr(std::runtime_error(message)));
          }};
  auto future = download->promise.get_future();
  if (*progress) {
    (*progress)(DownloadProgressStatus::STARTED);
  }
  httpClient_->sendRequest(std::move(callbacks), "GET", jsBundleUrl);
  return future;
}

std::string DevServerHelper::getInspectorUrl() const {
  bool profiling = jsinspector_modern::InspectorFlags::getInstance().getIsProfilingBuild();
  return fmt::format(
      "ws://{}:{}/inspector/device?name={}&app={}&device={}&profiling={}",
      devServerHost_,
      devServerPort_,
      urlEscape(deviceName_),
      appId_,
      deviceId_,
      profiling);
}

std::string DevServerHelper::getBundleUrl() const {
  if (sourcePath_.empty() || ngn::DevServer::fromBundleUrl(sourcePath_)) {
    return sourcePath_;
  }
  return fmt::format(
      "http://{}:{}/{}.bundle?platform=macos&dev=true&minify=false&app={}",
      devServerHost_,
      devServerPort_,
      sourcePath_,
      appId_);
}

std::string DevServerHelper::getPackagerConnectionUrl() const {
  if (auto server = ngn::DevServer::fromBundleUrl(sourcePath_)) {
    return server->packagerConnectionUrl();
  }
  return fmt::format("ws://{}:{}/message", devServerHost_, devServerPort_);
}

void DevServerHelper::openDebugger() const {
  httpClient_->sendRequest(
      {}, "POST", fmt::format("http://{}:{}/open-debugger?device={}", devServerHost_, devServerPort_, deviceId_));
}

void DevServerHelper::setupHMRClient() const {
  auto server = ngn::DevServer::fromBundleUrl(getBundleUrl());
  if (!server) {
    return;
  }
  javaScriptModuleCallback_("HMRClient", "setup", server->hmrSetupArgs());
}

} // namespace facebook::react
