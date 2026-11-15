#include "ngn/tracking.h"

namespace ngn {

namespace {

using Access = TrackingAuthority::Access;

folly::dynamic permissionOf(Access access) {
  bool granted = access == Access::Granted;
  bool askable = access == Access::NotDetermined;
  return folly::dynamic::object("status", granted ? "granted" : askable ? "undetermined" : "denied")("granted", granted)(
      "canAskAgain", askable)("expires", "never");
}

} // namespace

std::shared_ptr<NativeModule> makeTrackingModule(std::shared_ptr<TrackingAuthority> authority, bool noPrompts) {
  struct Tracking : NativeModule {
    Tracking(std::shared_ptr<TrackingAuthority> authority, bool noPrompts) : NativeModule("NgNativeTrackingTransparency") {
      sync("isAvailable", [](const folly::dynamic &) { return folly::dynamic(true); });
      promise("getTrackingPermissionsAsync", [authority](const folly::dynamic &, JsPromise promise) {
        promise.resolve(permissionOf(authority->access()));
      });
      promise("requestTrackingPermissionsAsync", [authority, noPrompts](const folly::dynamic &, JsPromise promise) {
        auto access = authority->access();
        if (noPrompts || access != Access::NotDetermined) {
          promise.resolve(permissionOf(access));
          return;
        }
        authority->requestAccess([promise](Access decided) { promise.resolve(permissionOf(decided)); });
      });
      sync("getAdvertisingId", [authority](const folly::dynamic &) {
        if (authority->access() != Access::Granted) {
          return folly::dynamic(nullptr);
        }
        auto id = authority->advertisingId();
        bool zeros = id.find_first_not_of("0-") == std::string::npos;
        return zeros ? folly::dynamic(nullptr) : folly::dynamic(id);
      });
    }
  };
  return std::make_shared<Tracking>(std::move(authority), noPrompts);
}

} // namespace ngn
