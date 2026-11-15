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
  // Applies at once, unless `holdSchemes`: then each waits in `heldSchemes` until a test runs it,
  // as the main thread would. Applying reads `systemScheme`, as the backend reads the system's.
  void setColorScheme(std::optional<std::string> scheme, std::function<void(std::string)> applied) override;
  void showAlert(const AlertRequest &request, std::function<void(int, std::string, std::string)> done) override;
  std::optional<std::string> clipboardText() override {
    return clipboard;
  }
  void setClipboardText(const std::string &text) override {
    clipboard = text;
    ++clipboardChanges;
  }
  int64_t clipboardChangeCount() override {
    return clipboardChanges;
  }
  std::optional<folly::dynamic> preference(const std::string &key) override;
  void setPreference(const std::string &key, std::optional<folly::dynamic> value) override;
  // An "image" here is the text "IMG <width>x<height>".
  std::optional<std::pair<double, double>> imageSize(const std::string &bytes) override;
  // Logged as "announce <low|medium|high> <text>".
  void announce(const Announcement &announcement) override;
  std::string appDataDirectory() override {
    return dataDirectory;
  }

  DeviceFacts deviceFacts{.osVersion = "26.1", .systemName = "macOS", .locale = "en-GB", .rightToLeft = false};
  // URLs that open: their scheme followed by a colon, such as "https:".
  std::vector<std::string> openableSchemes{"https:", "mailto:"};
  // The system's scheme now, and as the backend last read it (applying a change reads it again).
  std::string systemScheme{"light"};
  std::string readSystemScheme{"light"};
  std::optional<std::string> schemeOverride;
  bool holdSchemes{false};
  std::vector<std::function<void()>> heldSchemes;
  std::vector<AlertRequest> alerts;
  std::function<void(int, std::string, std::string)> answerAlert;
  std::optional<std::string> clipboard;
  int64_t clipboardChanges{40};
  std::map<std::string, folly::dynamic> preferences;
  std::string dataDirectory;
  std::vector<std::string> log;
};

} // namespace ngn::testing
