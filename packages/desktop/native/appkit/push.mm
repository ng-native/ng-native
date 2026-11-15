#import "push.h"

#import <AppKit/AppKit.h>

namespace ngn::appkit {

namespace {

class AppKitPushRegistrar final : public PushRegistrar {
 public:
  void registerForRemoteNotifications() override {
    dispatch_async(dispatch_get_main_queue(), ^{
      [NSApp registerForRemoteNotifications];
    });
  }
  void unregisterForRemoteNotifications() override {
    dispatch_async(dispatch_get_main_queue(), ^{
      [NSApp unregisterForRemoteNotifications];
    });
  }
};

folly::dynamic jsonOf(id value) {
  if (value == nil || value == NSNull.null) {
    return nullptr;
  }
  if ([value isKindOfClass:NSString.class]) {
    return std::string([value UTF8String]);
  }
  if ([value isKindOfClass:NSNumber.class]) {
    NSNumber *number = value;
    if (CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID()) {
      return static_cast<bool>(number.boolValue);
    }
    if (CFNumberIsFloatType((__bridge CFNumberRef)number)) {
      return number.doubleValue;
    }
    return static_cast<int64_t>(number.longLongValue);
  }
  if ([value isKindOfClass:NSArray.class]) {
    folly::dynamic out = folly::dynamic::array();
    for (id item in (NSArray *)value) {
      out.push_back(jsonOf(item));
    }
    return out;
  }
  if ([value isKindOfClass:NSDictionary.class]) {
    folly::dynamic out = folly::dynamic::object();
    for (id key in (NSDictionary *)value) {
      if ([key isKindOfClass:NSString.class]) {
        out[std::string([key UTF8String])] = jsonOf(((NSDictionary *)value)[key]);
      }
    }
    return out;
  }
  return nullptr;
}

} // namespace

std::shared_ptr<PushRegistrar> makePushRegistrar() {
  return std::make_shared<AppKitPushRegistrar>();
}

folly::dynamic pushPayload(NSDictionary *userInfo) {
  return [userInfo isKindOfClass:NSDictionary.class] ? jsonOf(userInfo) : folly::dynamic::object();
}

} // namespace ngn::appkit
