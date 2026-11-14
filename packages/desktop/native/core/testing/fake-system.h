// An in-memory System for the core tests: facts and answers a test sets, and a log of what the
// modules asked of the OS.
#pragma once

#include "ngn/system.h"

#include <map>
#include <string>
#include <vector>

namespace ngn::testing {

class FakeSystem final : public System {
 public:
  DeviceFacts facts() override {
    return deviceFacts;
  }
  void openUrl(const std::string &url, std::function<void(bool)> done) override;
  bool canOpenUrl(const std::string &url) override;
  void openSettings(std::function<void(bool)> done) override;
  std::string colorScheme() override;
  void setColorScheme(std::optional<std::string> scheme) override;
  void showAlert(const AlertRequest &request, std::function<void(int, std::string)> done) override;
  std::optional<std::string> clipboardText() override {
    return clipboard;
  }
  void setClipboardText(const std::string &text) override {
    clipboard = text;
  }
  std::optional<folly::dynamic> preference(const std::string &key) override;
  void setPreference(const std::string &key, std::optional<folly::dynamic> value) override;
  // An "image" here is the text "IMG <width>x<height>".
  std::optional<std::pair<double, double>> imageSize(const std::string &bytes) override;
  std::string appDataDirectory() override {
    return dataDirectory;
  }

  DeviceFacts deviceFacts{.osVersion = "26.1", .systemName = "macOS", .locale = "en-GB", .rightToLeft = false};
  // URLs that open: their scheme followed by a colon, such as "https:".
  std::vector<std::string> openableSchemes{"https:", "mailto:"};
  std::string systemScheme{"light"};
  std::optional<std::string> schemeOverride;
  std::vector<AlertRequest> alerts;
  std::function<void(int, std::string)> answerAlert;
  std::optional<std::string> clipboard;
  std::map<std::string, folly::dynamic> preferences;
  std::string dataDirectory;
  std::vector<std::string> log;
};

} // namespace ngn::testing
