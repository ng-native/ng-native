#include "tracking.h"

#import <AdSupport/AdSupport.h>
#import <AppTrackingTransparency/AppTrackingTransparency.h>
#import <Foundation/Foundation.h>

namespace ngn::appkit {

namespace {

using Access = TrackingAuthority::Access;

Access accessOf(ATTrackingManagerAuthorizationStatus status) {
  switch (status) {
    case ATTrackingManagerAuthorizationStatusAuthorized: return Access::Granted;
    case ATTrackingManagerAuthorizationStatusDenied: return Access::Denied;
    case ATTrackingManagerAuthorizationStatusRestricted: return Access::Restricted;
    default: return Access::NotDetermined;
  }
}

class AppTracking final : public TrackingAuthority {
 public:
  Access access() override {
    return accessOf(ATTrackingManager.trackingAuthorizationStatus);
  }

  void requestAccess(std::function<void(Access)> done) override {
    id reason = NSBundle.mainBundle.infoDictionary[@"NSUserTrackingUsageDescription"];
    if (![reason isKindOfClass:NSString.class] || [reason length] == 0 || access() != Access::NotDetermined) {
      done(access());
      return;
    }
    auto answer = std::make_shared<std::function<void(Access)>>(std::move(done));
    [ATTrackingManager requestTrackingAuthorizationWithCompletionHandler:^(ATTrackingManagerAuthorizationStatus status) {
      (*answer)(accessOf(status));
    }];
  }

  std::string advertisingId() override {
    return ASIdentifierManager.sharedManager.advertisingIdentifier.UUIDString.UTF8String;
  }
};

} // namespace

std::shared_ptr<TrackingAuthority> makeTrackingAuthority() {
  return std::make_shared<AppTracking>();
}

} // namespace ngn::appkit
