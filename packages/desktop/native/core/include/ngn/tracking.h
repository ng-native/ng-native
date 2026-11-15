// NgNativeTrackingTransparency: what @ng-native/expo's Tracking calls on
// expo-tracking-transparency, over a TrackingAuthority, which the AppKit backend implements with
// App Tracking Transparency and AdSupport.
//
// - isAvailable(): true; macOS has the permission.
// - getTrackingPermissionsAsync(), requestTrackingPermissionsAsync(): expo's permission shape.
//   Only what is undetermined is asked, never with `noPrompts` (NGN_NO_PROMPTS=1), and the
//   authority asks only when the app's Info.plist has NSUserTrackingUsageDescription.
// - getAdvertisingId(): the advertising identifier once tracking is allowed, else null, as is an
//   identifier of zeros, which macOS answers where it has none.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <string>

namespace ngn {

class TrackingAuthority {
 public:
  enum class Access { NotDetermined, Denied, Restricted, Granted };
  virtual ~TrackingAuthority() = default;
  virtual Access access() = 0;
  // Shows the OS's prompt and answers once the user decides; answers the access as it is, with no
  // prompt, when the app's Info.plist gives no reason to ask. Any thread.
  virtual void requestAccess(std::function<void(Access)> done) = 0;
  virtual std::string advertisingId() = 0;
};

std::shared_ptr<NativeModule> makeTrackingModule(std::shared_ptr<TrackingAuthority> authority, bool noPrompts);

} // namespace ngn
