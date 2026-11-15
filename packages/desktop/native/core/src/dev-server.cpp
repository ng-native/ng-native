#include "ngn/dev-server.h"

#include <charconv>

namespace ngn {

namespace {

std::string queryValue(const std::string &query, const std::string &key) {
  size_t start = 0;
  while (start <= query.size()) {
    size_t end = query.find('&', start);
    if (end == std::string::npos) {
      end = query.size();
    }
    std::string pair = query.substr(start, end - start);
    if (pair.rfind(key + "=", 0) == 0) {
      return pair.substr(key.size() + 1);
    }
    start = end + 1;
  }
  return "";
}

} // namespace

std::optional<DevServer> DevServer::fromBundleUrl(const std::string &url) {
  DevServer server;
  size_t schemeEnd = url.find("://");
  if (schemeEnd == std::string::npos) {
    return std::nullopt;
  }
  server.scheme = url.substr(0, schemeEnd);
  if (server.scheme != "http" && server.scheme != "https") {
    return std::nullopt;
  }
  size_t authorityStart = schemeEnd + 3;
  size_t pathStart = url.find_first_of("/?#", authorityStart);
  std::string authority = url.substr(authorityStart, pathStart - authorityStart);
  if (authority.empty()) {
    return std::nullopt;
  }
  // The host ends at its closing bracket for an IPv6 address ([::1]:8081), else at the colon.
  size_t hostEnd;
  if (authority.front() == '[') {
    size_t bracket = authority.find(']');
    if (bracket == std::string::npos) {
      return std::nullopt;
    }
    hostEnd = bracket + 1;
    if (hostEnd < authority.size() && authority[hostEnd] != ':') {
      return std::nullopt;
    }
  } else {
    hostEnd = authority.rfind(':');
  }
  if (hostEnd != std::string::npos && hostEnd < authority.size()) {
    std::string port = authority.substr(hostEnd + 1);
    auto [end, error] = std::from_chars(port.data(), port.data() + port.size(), server.port);
    if (error != std::errc() || end != port.data() + port.size() || port.empty()) {
      return std::nullopt;
    }
    server.host = authority.substr(0, hostEnd);
  } else {
    server.host = authority;
    server.port = server.scheme == "https" ? 443 : 80;
  }

  std::string path;
  std::string query;
  if (pathStart != std::string::npos) {
    size_t queryStart = url.find('?', pathStart);
    path = url.substr(pathStart, queryStart - pathStart);
    if (queryStart != std::string::npos) {
      query = url.substr(queryStart + 1);
      query = query.substr(0, query.find('#'));
    }
  }
  if (!path.empty() && path.front() == '/') {
    path.erase(0, 1);
  }
  constexpr std::string_view suffix = ".bundle";
  if (path.size() >= suffix.size() && path.compare(path.size() - suffix.size(), suffix.size(), suffix) == 0) {
    path.resize(path.size() - suffix.size());
  }
  server.entry = path;
  server.platform = queryValue(query, "platform");
  if (server.platform.empty()) {
    server.platform = "macos";
  }
  server.bundleUrl = url;
  return server;
}

std::string DevServer::packagerConnectionUrl() const {
  return (scheme == "https" ? "wss://" : "ws://") + host + ":" + std::to_string(port) + "/message";
}

folly::dynamic DevServer::hmrSetupArgs() const {
  return folly::dynamic::array(platform, entry, host, port, true, scheme);
}

} // namespace ngn
