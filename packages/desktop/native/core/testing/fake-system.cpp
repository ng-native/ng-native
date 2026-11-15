#include "fake-system.h"

#include <cstdio>

namespace ngn::testing {

void FakeSystem::openUrl(const std::string &url, std::function<void(bool)> done) {
  log.push_back("open " + url);
  done(canOpenUrl(url));
}

bool FakeSystem::canOpenUrl(const std::string &url) {
  for (const auto &scheme : openableSchemes) {
    if (url.rfind(scheme, 0) == 0) {
      return true;
    }
  }
  return false;
}

void FakeSystem::openSettings(std::function<void(bool)> done) {
  log.push_back("open settings");
  done(true);
}

std::string FakeSystem::colorScheme() {
  return schemeOverride.value_or(systemScheme);
}

void FakeSystem::setColorScheme(std::optional<std::string> scheme) {
  log.push_back("scheme " + scheme.value_or("system"));
  schemeOverride = std::move(scheme);
}

void FakeSystem::announce(const Announcement &announcement) {
  const char *names[] = {"low", "medium", "high"};
  log.push_back(std::string("announce ") + names[static_cast<int>(announcement.priority)] + " " + announcement.text);
}

void FakeSystem::showAlert(const AlertRequest &request, std::function<void(int, std::string)> done) {
  alerts.push_back(request);
  answerAlert = std::move(done);
}

std::optional<std::pair<double, double>> FakeSystem::imageSize(const std::string &bytes) {
  double w = 0, h = 0;
  if (std::sscanf(bytes.c_str(), "IMG %lfx%lf", &w, &h) == 2) {
    return std::pair{w, h};
  }
  return std::nullopt;
}

std::optional<folly::dynamic> FakeSystem::preference(const std::string &key) {
  auto it = preferences.find(key);
  if (it == preferences.end()) {
    return std::nullopt;
  }
  return it->second;
}

void FakeSystem::setPreference(const std::string &key, std::optional<folly::dynamic> value) {
  if (value) {
    preferences[key] = *value;
  } else {
    preferences.erase(key);
  }
}

} // namespace ngn::testing
