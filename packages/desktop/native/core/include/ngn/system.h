// The system interface: the OS calls the core's modules make, which a backend answers with the
// toolkit's own (NSWorkspace, NSAlert, NSPasteboard, NSUserDefaults on macOS). Narrow on purpose:
// the logic around each call (what JavaScript asked, what it gets back, what persists) is core
// code, the same on every backend.
#pragma once

#include <folly/dynamic.h>

#include <functional>
#include <memory>
#include <mutex>
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

// How an announcement takes its turn with what a screen reader is saying: low and medium wait for
// it, high interrupts.
enum class AnnouncementPriority { Low, Medium, High };

struct Announcement {
  std::string text;
  AnnouncementPriority priority{AnnouncementPriority::High};
  bool operator==(const Announcement &) const = default;
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
  // Draws the app in `scheme` ("light" or "dark"), or follows the system again for nothing. Once the
  // change applies, `applied` gets the scheme that change applied (for nothing, the system's scheme
  // read as it applies), on the thread that applies the changes in order: a later change's answer
  // always comes after an earlier one's, and an earlier one's is never the later one's scheme.
  virtual void setColorScheme(std::optional<std::string> scheme, std::function<void(std::string)> applied) = 0;

  // `done` gets the index of the button pressed and the text typed: for a login-password prompt,
  // the login as `text` and the password beside it. Any thread.
  virtual void showAlert(
      const AlertRequest &request,
      std::function<void(int button, std::string text, std::string password)> done) = 0;

  virtual std::optional<std::string> clipboardText() = 0;
  virtual void setClipboardText(const std::string &text) = 0;
  // A number that moves each time anything (this app or another) changes the clipboard.
  virtual int64_t clipboardChangeCount() = 0;

  // Small values that persist across launches (NSUserDefaults on macOS).
  virtual std::optional<folly::dynamic> preference(const std::string &key) = 0;
  virtual void setPreference(const std::string &key, std::optional<folly::dynamic> value) = 0;

  // The pixel size of an encoded image (PNG, JPEG, GIF, HEIC and what else the OS decodes), or
  // nothing when it is not one.
  virtual std::optional<std::pair<double, double>> imageSize(const std::string &bytes) = 0;

  // Has the screen reader say `announcement` (NSAccessibilityAnnouncementRequestedNotification on
  // macOS). Nothing is said when none is running.
  virtual void announce(const Announcement &announcement) = 0;

  // Where the app keeps its own files, created if missing.
  virtual std::string appDataDirectory() = 0;
};

// The colour scheme a backend's System answers: the app's override while one holds, the system's
// own otherwise. Any thread.
class ColorSchemeOverride {
 public:
  explicit ColorSchemeOverride(std::string systemScheme);
  // What System::colorScheme answers.
  std::string current() const;
  // The app's override, or none to follow the system again.
  void set(std::optional<std::string> scheme);
  // The system's own scheme changed (or was read again), override or not.
  void systemChanged(std::string scheme);
  // What a change to `scheme` applied, as System::setColorScheme tells it: that scheme, or the
  // system's for none. Not the latest override, which a later change may have set already.
  std::string applied(const std::optional<std::string> &scheme) const;

 private:
  mutable std::mutex mutex_;
  std::string system_;
  std::optional<std::string> override_;
};

// Strings that persist across launches, the backend's (NSUserDefaults on macOS). Any thread.
class StringStore {
 public:
  virtual ~StringStore() = default;
  virtual std::optional<std::string> get(const std::string &key) = 0;
  virtual void set(const std::string &key, const std::string &value) = 0;
  virtual void remove(const std::string &key) = 0;
};

// System::preference and setPreference over a string store: each value as JSON, and each key
// prefixed with the app's id when the store is shared with other apps (on macOS, a bare host
// binary's defaults, which every app run with it reads). A stored value that is not JSON reads as
// nothing.
class JsonPreferences {
 public:
  JsonPreferences(std::shared_ptr<StringStore> store, const std::string &appId, bool sharedStore);
  std::optional<folly::dynamic> get(const std::string &key) const;
  void set(const std::string &key, const std::optional<folly::dynamic> &value) const;

 private:
  std::shared_ptr<StringStore> store_;
  std::string prefix_;
};

} // namespace ngn
