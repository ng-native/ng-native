// NgNativeSharing: what @ng-native/device's Sharing calls on macOS, where React Native's Share has
// no implementation, over a SharePicker: AppKit's NSSharingServicePicker shown at the key window.
//
// - share({message, url, title}): {action: 'sharedAction', activityType} with the service the user
//   shared through, or {action: 'dismissedAction', activityType: null}. A request with neither a
//   message nor a url is refused, and one at a time is shown. With `noPrompts`
//   (NGN_NO_PROMPTS=1) nothing is shown, and the share answers as dismissed.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

class SharePicker {
 public:
  struct Request {
    std::optional<std::string> message;
    std::optional<std::string> url;
    std::optional<std::string> title;
  };
  virtual ~SharePicker() = default;
  // Shows the picker; answers once, on any thread, with the service picked (its name, as
  // NSSharingService's title), or nothing when it was dismissed.
  virtual void show(const Request &request, std::function<void(std::optional<std::string> service)> done) = 0;
};

std::shared_ptr<NativeModule> makeSharingModule(std::shared_ptr<SharePicker> picker, bool noPrompts = false);

} // namespace ngn
