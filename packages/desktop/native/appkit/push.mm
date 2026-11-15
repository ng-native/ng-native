#import "push.h"

#import <AppKit/AppKit.h>

#include <optional>

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

// The whole string, U+0000 included: UTF8String alone stops at the first one.
std::string utf8Of(NSString *string) {
  return std::string(string.UTF8String, [string lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

// No value for what JSON cannot say, so its key or item is left out.
std::optional<folly::dynamic> jsonOf(id value) {
  if (value == nil || value == NSNull.null) {
    return folly::dynamic(nullptr);
  }
  if ([value isKindOfClass:NSString.class]) {
    return folly::dynamic(utf8Of(value));
  }
  if ([value isKindOfClass:NSNumber.class]) {
    NSNumber *number = value;
    if (CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID()) {
      return folly::dynamic(static_cast<bool>(number.boolValue));
    }
    if (CFNumberIsFloatType((__bridge CFNumberRef)number)) {
      return folly::dynamic(number.doubleValue);
    }
    return folly::dynamic(static_cast<int64_t>(number.longLongValue));
  }
  if ([value isKindOfClass:NSArray.class]) {
    folly::dynamic out = folly::dynamic::array();
    for (id item in (NSArray *)value) {
      if (auto json = jsonOf(item)) {
        out.push_back(std::move(*json));
      }
    }
    return out;
  }
  if ([value isKindOfClass:NSDictionary.class]) {
    folly::dynamic out = folly::dynamic::object();
    for (id key in (NSDictionary *)value) {
      if ([key isKindOfClass:NSString.class]) {
        if (auto json = jsonOf(((NSDictionary *)value)[key])) {
          out[utf8Of(key)] = std::move(*json);
        }
      }
    }
    return out;
  }
  return std::nullopt;
}

} // namespace

std::shared_ptr<PushRegistrar> makePushRegistrar() {
  return std::make_shared<AppKitPushRegistrar>();
}

folly::dynamic pushPayload(NSDictionary *userInfo) {
  return [userInfo isKindOfClass:NSDictionary.class] ? *jsonOf(userInfo) : folly::dynamic::object();
}

} // namespace ngn::appkit
