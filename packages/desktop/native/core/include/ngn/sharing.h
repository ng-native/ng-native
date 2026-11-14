// NgNativeSharing: what @ng-native/device's Sharing calls on macOS, where React Native's Share has
// no implementation, over a SharePicker: AppKit's NSSharingServicePicker shown at the key window.
//
// - share({message, url, title}): {action: 'sharedAction', activityType} with the service the user
//   picked, or {action: 'dismissedAction', activityType: null}. A request with neither a message
//   nor a url is refused, and one at a time is shown.
//
// The contract only: the AppKit picker needs a window to draw in and is not built yet, so the host
// does not register the module and Sharing is absent on macOS until it does.
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

std::shared_ptr<NativeModule> makeSharingModule(std::shared_ptr<SharePicker> picker);

} // namespace ngn
