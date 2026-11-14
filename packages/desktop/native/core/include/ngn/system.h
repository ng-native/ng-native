// The system interface: the OS calls the core's modules make, which a backend answers with the
// toolkit's own (NSWorkspace, NSAlert, NSPasteboard, NSUserDefaults on macOS). Narrow on purpose:
// the logic around each call (what JavaScript asked, what it gets back, what persists) is core
// code, the same on every backend.
#pragma once

#include <folly/dynamic.h>

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct DeviceFacts {
  // "26.1"
  std::string osVersion;
  // "macOS"
  std::string systemName;
  // A BCP 47 identifier such as "en-GB" (React Native's localeIdentifier uses an underscore).
  std::string locale;
  // The system's layout direction for the app's preferred language.
  bool rightToLeft{false};
};

enum class AlertButtonRole { Default, Cancel, Destructive };
enum class AlertInput { None, PlainText, SecureText, LoginPassword };

struct AlertButton {
  std::string label;
  AlertButtonRole role{AlertButtonRole::Default};
};

struct AlertRequest {
  std::string title;
  std::string message;
  // Right to left, as AppKit places them: the first is the default button (Return).
  std::vector<AlertButton> buttons;
  // The button Escape presses, or -1.
  int cancelIndex{-1};
  AlertInput input{AlertInput::None};
  std::string defaultValue;
};

class System {
 public:
  virtual ~System() = default;

  virtual DeviceFacts facts() = 0;

  // Opens a URL in the app that handles it. `done` gets whether one did; any thread.
  virtual void openUrl(const std::string &url, std::function<void(bool opened)> done) = 0;
  virtual bool canOpenUrl(const std::string &url) = 0;
  virtual void openSettings(std::function<void(bool opened)> done) = 0;

  // "light" or "dark", as the system draws the app now (an override included).
  virtual std::string colorScheme() = 0;
  // Draws the app in `scheme` ("light" or "dark"), or follows the system again for nothing.
  virtual void setColorScheme(std::optional<std::string> scheme) = 0;

  // `done` gets the index of the button pressed and the text typed; any thread.
  virtual void showAlert(const AlertRequest &request, std::function<void(int button, std::string text)> done) = 0;

  virtual std::optional<std::string> clipboardText() = 0;
  virtual void setClipboardText(const std::string &text) = 0;

  // Small values that persist across launches (NSUserDefaults on macOS).
  virtual std::optional<folly::dynamic> preference(const std::string &key) = 0;
  virtual void setPreference(const std::string &key, std::optional<folly::dynamic> value) = 0;

  // The pixel size of an encoded image (PNG, JPEG, GIF, HEIC and what else the OS decodes), or
  // nothing when it is not one.
  virtual std::optional<std::pair<double, double>> imageSize(const std::string &bytes) = 0;

  // Where the app keeps its own files, created if missing.
  virtual std::string appDataDirectory() = 0;
};

} // namespace ngn
