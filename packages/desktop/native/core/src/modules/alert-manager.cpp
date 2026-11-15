// AlertManager: Alert.alert and Alert.prompt, which Dialogs builds on. React Native iOS lays the
// buttons out as UIAlertController does; a Mac alert puts the default button on the right with
// Cancel beside it, so the order changes here, once for every backend.
#include "ngn/core-modules.h"

#include <folly/json.h>

#include <algorithm>

namespace ngn {

namespace {

std::string stringArg(const folly::dynamic &args, const char *key) {
  auto it = args.find(key);
  if (it == args.items().end() || it->second.isNull()) {
    return "";
  }
  return it->second.isString() ? it->second.asString() : folly::toJson(it->second);
}

} // namespace

PreparedAlert prepareAlert(const folly::dynamic &args) {
  PreparedAlert out;
  auto &request = out.request;
  request.title = stringArg(args, "title");
  request.message = stringArg(args, "message");
  request.defaultValue = stringArg(args, "defaultValue");
  std::string type = stringArg(args, "type");
  request.input = type == "plain-text"       ? AlertInput::PlainText
      : type == "secure-text"                ? AlertInput::SecureText
      : type == "login-password"             ? AlertInput::LoginPassword
                                             : AlertInput::None;
  std::string cancelKey = stringArg(args, "cancelButtonKey");
  std::string destructiveKey = stringArg(args, "destructiveButtonKey");
  std::string preferredKey = stringArg(args, "preferredButtonKey");

  // In JavaScript's order: [{ "0": "Cancel" }, { "1": "OK" }].
  std::vector<std::pair<std::string, std::string>> given;
  if (auto it = args.find("buttons"); it != args.items().end() && it->second.isArray()) {
    for (const auto &button : it->second) {
      if (button.isObject()) {
        for (const auto &[key, label] : button.items()) {
          given.emplace_back(key.asString(), label.isString() ? label.asString() : "");
        }
      }
    }
  }
  if (given.empty()) {
    // React Native iOS's default: one OK, which is also what Escape presses.
    given.emplace_back("0", "OK");
    if (request.input == AlertInput::None) {
      cancelKey = "0";
    }
  }

  // The default button: the preferred one, else the last that is not Cancel (the one iOS puts on
  // the right), else Cancel itself.
  std::string defaultKey = preferredKey;
  if (defaultKey.empty()) {
    for (auto it = given.rbegin(); it != given.rend(); ++it) {
      if (it->first != cancelKey) {
        defaultKey = it->first;
        break;
      }
    }
  }
  if (defaultKey.empty()) {
    defaultKey = given.back().first;
  }

  std::vector<std::pair<std::string, std::string>> ordered;
  auto take = [&](const std::string &key) {
    auto it = std::find_if(given.begin(), given.end(), [&](const auto &b) { return b.first == key; });
    if (it != given.end()) {
      ordered.push_back(*it);
      given.erase(it);
    }
  };
  take(defaultKey);
  if (cancelKey != defaultKey) {
    take(cancelKey);
  }
  for (auto it = given.rbegin(); it != given.rend(); ++it) {
    ordered.push_back(*it);
  }

  for (size_t i = 0; i < ordered.size(); i++) {
    const auto &[key, label] = ordered[i];
    AlertButtonRole role = key == cancelKey ? AlertButtonRole::Cancel
        : key == destructiveKey             ? AlertButtonRole::Destructive
                                            : AlertButtonRole::Default;
    request.buttons.push_back({label, role});
    out.keys.push_back(key);
    if (key == cancelKey) {
      request.cancelIndex = static_cast<int>(i);
    }
  }
  return out;
}

std::shared_ptr<NativeModule> makeAlertManager(const CoreModuleServices &s) {
  struct AlertManager : NativeModule {
    explicit AlertManager(const CoreModuleServices &s) : NativeModule("AlertManager") {
      auto system = s.system;
      bool fake = s.fakeSystemUI;
      async("alertWithArgs", [system, fake](const folly::dynamic &args, std::vector<JsCallback> callbacks) {
        auto prepared = prepareAlert(args.size() > 0 && args[0].isObject() ? args[0] : folly::dynamic::object());
        JsCallback callback = callbacks.empty() ? nullptr : callbacks[0];
        auto keys = prepared.keys;
        if (fake) {
          int cancel = prepared.request.cancelIndex;
          if (callback && cancel >= 0 && static_cast<size_t>(cancel) < keys.size()) {
            callback(folly::dynamic::array(keys[cancel], prepared.request.defaultValue));
          }
          return;
        }
        system->showAlert(prepared.request, [callback, keys](int button, std::string text) {
          if (callback && button >= 0 && static_cast<size_t>(button) < keys.size()) {
            callback(folly::dynamic::array(keys[button], text));
          }
        });
      });
    }
  };
  return std::make_shared<AlertManager>(s);
}

} // namespace ngn
