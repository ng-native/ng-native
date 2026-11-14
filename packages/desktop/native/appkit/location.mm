#import "location.h"

#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>

#include <atomic>
#include <map>
#include <vector>

using Authorization = ngn::LocationSource::Authorization;
using Fix = ngn::LocationSource::Fix;

namespace {

Authorization authorizationOf(CLAuthorizationStatus status) {
  switch (status) {
    case kCLAuthorizationStatusNotDetermined: return Authorization::NotDetermined;
    case kCLAuthorizationStatusRestricted: return Authorization::Restricted;
    case kCLAuthorizationStatusDenied: return Authorization::Denied;
    default: return Authorization::Granted;
  }
}

Fix fixOf(CLLocation *location) {
  Fix fix;
  fix.latitude = location.coordinate.latitude;
  fix.longitude = location.coordinate.longitude;
  if (location.verticalAccuracy >= 0) {
    fix.altitude = location.altitude;
    fix.altitudeAccuracy = location.verticalAccuracy;
  }
  if (location.horizontalAccuracy >= 0) {
    fix.accuracy = location.horizontalAccuracy;
  }
  if (location.course >= 0) {
    fix.heading = location.course;
  }
  if (location.speed >= 0) {
    fix.speed = location.speed;
  }
  fix.timestamp = location.timestamp.timeIntervalSince1970 * 1000;
  return fix;
}

void onMain(dispatch_block_t block) {
  if (NSThread.isMainThread) {
    block();
  } else {
    dispatch_async(dispatch_get_main_queue(), block);
  }
}

} // namespace

// One CLLocationManager's reports, as blocks.
@interface NGNLocationDelegate : NSObject <CLLocationManagerDelegate>
@property (nonatomic, copy) void (^authorizationChanged)(CLAuthorizationStatus status);
@property (nonatomic, copy) void (^located)(NSArray<CLLocation *> *locations);
@property (nonatomic, copy) void (^failed)(NSError *error);
@end

@implementation NGNLocationDelegate
- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager {
  if (self.authorizationChanged) {
    self.authorizationChanged(manager.authorizationStatus);
  }
}
- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
  if (self.located) {
    self.located(locations);
  }
}
- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
  if (self.failed) {
    self.failed(error);
  }
}
@end

namespace ngn::appkit {

namespace {

class CoreLocationSource final : public LocationSource, public std::enable_shared_from_this<CoreLocationSource> {
 public:
  CoreLocationSource() {
    manager_ = [[CLLocationManager alloc] init];
    delegate_ = [[NGNLocationDelegate alloc] init];
    status_ = static_cast<int>(authorizationOf(manager_.authorizationStatus));
    std::atomic<int> *status = &status_;
    auto *waiting = &waiting_;
    delegate_.authorizationChanged = ^(CLAuthorizationStatus now) {
      status->store(static_cast<int>(authorizationOf(now)));
      if (authorizationOf(now) == Authorization::NotDetermined) {
        return;
      }
      auto done = std::move(*waiting);
      waiting->clear();
      for (auto &fn : done) {
        fn(authorizationOf(now));
      }
    };
    manager_.delegate = delegate_;
  }

  Authorization authorization() override {
    return static_cast<Authorization>(status_.load());
  }

  void requestAuthorization(std::function<void(Authorization)> done) override {
    auto self = shared_from_this();
    onMain(^{
      auto now = self->authorization();
      if (now != Authorization::NotDetermined || !explainsWhy()) {
        done(now);
        return;
      }
      self->waiting_.push_back(done);
      [self->manager_ requestWhenInUseAuthorization];
    });
  }

  void currentFix(double accuracy, std::function<void(std::optional<Fix>, std::string)> done) override {
    auto self = shared_from_this();
    onMain(^{
      int id = ++self->next_;
      CLLocationManager *manager = [[CLLocationManager alloc] init];
      NGNLocationDelegate *delegate = [[NGNLocationDelegate alloc] init];
      __block bool answered = false;
      auto finish = [self, id](void) {
        self->oneShots_.erase(id);
      };
      delegate.located = ^(NSArray<CLLocation *> *locations) {
        if (answered || locations.lastObject == nil) {
          return;
        }
        answered = true;
        done(fixOf(locations.lastObject), "");
        finish();
      };
      delegate.failed = ^(NSError *error) {
        if (answered) {
          return;
        }
        answered = true;
        done(std::nullopt, error.localizedDescription.UTF8String);
        finish();
      };
      manager.delegate = delegate;
      manager.desiredAccuracy = accuracy > 0 ? accuracy : kCLLocationAccuracyBest;
      self->oneShots_[id] = {manager, delegate};
      [manager requestLocation];
    });
  }

  int watch(double accuracy, double distance, std::function<void(const Fix &)> fix) override {
    int id = ++next_;
    auto self = shared_from_this();
    onMain(^{
      CLLocationManager *manager = [[CLLocationManager alloc] init];
      NGNLocationDelegate *delegate = [[NGNLocationDelegate alloc] init];
      delegate.located = ^(NSArray<CLLocation *> *locations) {
        for (CLLocation *location in locations) {
          fix(fixOf(location));
        }
      };
      manager.delegate = delegate;
      manager.desiredAccuracy = accuracy > 0 ? accuracy : kCLLocationAccuracyBest;
      manager.distanceFilter = distance > 0 ? distance : kCLDistanceFilterNone;
      self->watches_[id] = {manager, delegate};
      [manager startUpdatingLocation];
    });
    return id;
  }

  void stopWatching(int handle) override {
    auto self = shared_from_this();
    onMain(^{
      auto it = self->watches_.find(handle);
      if (it != self->watches_.end()) {
        [it->second.manager stopUpdatingLocation];
        self->watches_.erase(it);
      }
    });
  }

 private:
  struct Running {
    CLLocationManager *manager;
    NGNLocationDelegate *delegate;
  };

  static bool explainsWhy() {
    NSDictionary *info = NSBundle.mainBundle.infoDictionary;
    return info[@"NSLocationUsageDescription"] != nil || info[@"NSLocationWhenInUseUsageDescription"] != nil;
  }

  // Main thread only, but for status_ and next_.
  CLLocationManager *manager_;
  NGNLocationDelegate *delegate_;
  std::atomic<int> status_{0};
  std::atomic<int> next_{0};
  std::vector<std::function<void(Authorization)>> waiting_;
  std::map<int, Running> oneShots_;
  std::map<int, Running> watches_;
};

} // namespace

std::shared_ptr<LocationSource> makeLocationSource() {
  return std::make_shared<CoreLocationSource>();
}

} // namespace ngn::appkit
