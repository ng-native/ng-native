#import "notifications.h"

#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>

#include <folly/json.h>

namespace {

NSString *ns(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

std::string str(NSString *s) {
  return s != nil ? std::string(s.UTF8String) : std::string{};
}

// The request as the core read it, kept in the notification's userInfo so that what the OS gives
// back reads as what was scheduled.
NSString *const kRequestKey = @"ngnRequest";

folly::dynamic requestRecord(const ngn::NotificationRequest &request) {
  return ngn::notificationRequestJson(request);
}

ngn::NotificationRequest fromRecord(UNNotificationRequest *request) {
  ngn::NotificationRequest out;
  out.identifier = str(request.identifier);
  out.title = str(request.content.title);
  out.subtitle = str(request.content.subtitle);
  out.body = str(request.content.body);
  if (NSString *json = request.content.userInfo[kRequestKey]; [json isKindOfClass:NSString.class]) {
    try {
      auto record = folly::parseJson(str(json));
      const auto &content = record["content"];
      if (content["data"].isObject()) {
        out.data = content["data"];
      }
      if (content["sound"].isString()) {
        out.sound = content["sound"].asString();
      }
      if (content["badge"].isNumber()) {
        out.badge = static_cast<int>(content["badge"].asInt());
      }
      const auto &trigger = record["trigger"];
      if (trigger.isObject()) {
        auto type = trigger["type"].asString();
        if (type == "timeInterval") {
          out.trigger = {.kind = ngn::NotificationTrigger::Kind::Interval,
                         .seconds = trigger["seconds"].asDouble(),
                         .repeats = trigger["repeats"].asBool()};
        } else if (type == "date") {
          out.trigger = {.kind = ngn::NotificationTrigger::Kind::Date, .date = trigger["value"].asDouble()};
        } else if (type == "calendar") {
          out.trigger.kind = ngn::NotificationTrigger::Kind::Calendar;
          out.trigger.repeats = trigger["repeats"].asBool();
          for (const auto &[name, value] : trigger["dateComponents"].items()) {
            out.trigger.components[name.asString()] = static_cast<int>(value.asInt());
          }
        }
      }
    } catch (const std::exception &) {
    }
  }
  return out;
}

NSDateComponents *componentsOf(const ngn::NotificationTrigger &trigger) {
  NSDateComponents *components = [NSDateComponents new];
  if (trigger.kind == ngn::NotificationTrigger::Kind::Date) {
    NSDate *date = [NSDate dateWithTimeIntervalSince1970:trigger.date / 1000];
    return [NSCalendar.currentCalendar
        components:NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay | NSCalendarUnitHour |
                   NSCalendarUnitMinute | NSCalendarUnitSecond
          fromDate:date];
  }
  for (const auto &[name, value] : trigger.components) {
    if (name == "year") components.year = value;
    if (name == "month") components.month = value;
    if (name == "day") components.day = value;
    if (name == "weekday") components.weekday = value;
    if (name == "hour") components.hour = value;
    if (name == "minute") components.minute = value;
    if (name == "second") components.second = value;
  }
  return components;
}

UNNotificationTrigger *triggerOf(const ngn::NotificationTrigger &trigger) {
  switch (trigger.kind) {
    case ngn::NotificationTrigger::Kind::Now:
      return nil;
    case ngn::NotificationTrigger::Kind::Interval:
      return [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:trigger.seconds repeats:trigger.repeats];
    case ngn::NotificationTrigger::Kind::Date:
    case ngn::NotificationTrigger::Kind::Calendar:
      return [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:componentsOf(trigger)
                                                                      repeats:trigger.repeats];
  }
  return nil;
}

ngn::NotificationAuthorization authorizationOf(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusNotDetermined:
      return ngn::NotificationAuthorization::NotDetermined;
    case UNAuthorizationStatusDenied:
      return ngn::NotificationAuthorization::Denied;
    default:
      return ngn::NotificationAuthorization::Authorized;
  }
}

} // namespace

@interface NGNNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@property (nonatomic) std::shared_ptr<ngn::NotificationEvents> events;
@property (nonatomic, copy) void (^badge)(int count);
@end

@implementation NGNNotificationDelegate
// One delivered while the app runs: shown as a banner in its list with its sound, as a Mac app's
// own are, and heard by the app.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  auto request = fromRecord(notification.request);
  if (request.badge && self.badge) {
    int count = *request.badge;
    dispatch_async(dispatch_get_main_queue(), ^{
      self.badge(count);
    });
  }
  self.events->received(notification.date.timeIntervalSince1970 * 1000, request);
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList |
                    UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  self.events->responded(response.notification.date.timeIntervalSince1970 * 1000, fromRecord(response.notification.request));
  completionHandler();
}
@end

namespace ngn::appkit {

namespace {

class AppKitNotificationCenter final : public NotificationCenter {
 public:
  explicit AppKitNotificationCenter(std::shared_ptr<NotificationEvents> events) {
    NSBundle *bundle = NSBundle.mainBundle;
    canPost_ = bundle.bundleIdentifier != nil && [bundle.bundlePath.pathExtension isEqualToString:@"app"];
    if (canPost_) {
      delegate_ = [NGNNotificationDelegate new];
      delegate_.events = std::move(events);
      delegate_.badge = ^(int count) {
        setBadgeNow(count);
      };
      UNUserNotificationCenter.currentNotificationCenter.delegate = delegate_;
    }
  }

  bool canPost() override {
    return canPost_;
  }

  void authorization(std::function<void(NotificationAuthorization)> done) override {
    [UNUserNotificationCenter.currentNotificationCenter getNotificationSettingsWithCompletionHandler:^(
                                                             UNNotificationSettings *settings) {
      done(authorizationOf(settings.authorizationStatus));
    }];
  }

  void requestAuthorization(std::function<void(NotificationAuthorization)> done) override {
    auto options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
    [UNUserNotificationCenter.currentNotificationCenter
        requestAuthorizationWithOptions:options
                      completionHandler:^(BOOL granted, NSError *) {
                        done(granted ? NotificationAuthorization::Authorized : NotificationAuthorization::Denied);
                      }];
  }

  void add(const NotificationRequest &request, std::function<void(std::optional<std::string>)> done) override {
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = ns(request.title);
    content.subtitle = ns(request.subtitle);
    content.body = ns(request.body);
    if (request.sound == "default") {
      content.sound = UNNotificationSound.defaultSound;
    } else if (!request.sound.empty()) {
      content.sound = [UNNotificationSound soundNamed:ns(request.sound)];
    }
    content.userInfo = @{kRequestKey : ns(folly::toJson(requestRecord(request)))};
    UNNotificationRequest *un = [UNNotificationRequest requestWithIdentifier:ns(request.identifier)
                                                                      content:content
                                                                      trigger:triggerOf(request.trigger)];
    [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:un
                                                         withCompletionHandler:^(NSError *error) {
                                                           if (error != nil) {
                                                             done(str(error.localizedDescription));
                                                           } else {
                                                             done(std::nullopt);
                                                           }
                                                         }];
  }

  void pending(std::function<void(std::vector<NotificationRequest>)> done) override {
    [UNUserNotificationCenter.currentNotificationCenter
        getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *requests) {
          std::vector<NotificationRequest> out;
          for (UNNotificationRequest *request in requests) {
            out.push_back(fromRecord(request));
          }
          done(std::move(out));
        }];
  }

  void delivered(std::function<void(std::vector<std::pair<double, NotificationRequest>>)> done) override {
    [UNUserNotificationCenter.currentNotificationCenter
        getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *notifications) {
          std::vector<std::pair<double, NotificationRequest>> out;
          for (UNNotification *notification in notifications) {
            out.emplace_back(notification.date.timeIntervalSince1970 * 1000, fromRecord(notification.request));
          }
          done(std::move(out));
        }];
  }

  void removePending(const std::vector<std::string> &identifiers) override {
    [UNUserNotificationCenter.currentNotificationCenter removePendingNotificationRequestsWithIdentifiers:list(identifiers)];
  }
  void removeAllPending() override {
    [UNUserNotificationCenter.currentNotificationCenter removeAllPendingNotificationRequests];
  }
  void removeDelivered(const std::vector<std::string> &identifiers) override {
    [UNUserNotificationCenter.currentNotificationCenter removeDeliveredNotificationsWithIdentifiers:list(identifiers)];
  }
  void removeAllDelivered() override {
    [UNUserNotificationCenter.currentNotificationCenter removeAllDeliveredNotifications];
  }

  std::optional<double> nextDate(const NotificationTrigger &trigger) override {
    NSDate *next = nil;
    switch (trigger.kind) {
      case NotificationTrigger::Kind::Now:
        return [NSDate date].timeIntervalSince1970 * 1000;
      case NotificationTrigger::Kind::Interval:
        next = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:trigger.seconds repeats:NO].nextTriggerDate;
        break;
      default:
        next = ((UNCalendarNotificationTrigger *)triggerOf(trigger)).nextTriggerDate;
    }
    if (next == nil) {
      return std::nullopt;
    }
    return next.timeIntervalSince1970 * 1000;
  }

  int badge() override {
    return badge_.load();
  }

  void setBadge(int count) override {
    // Read back at once; the Dock draws it on the main thread.
    badge_ = count;
    dispatch_async(dispatch_get_main_queue(), ^{
      setBadgeNow(count);
    });
  }

 private:
  static NSArray<NSString *> *list(const std::vector<std::string> &identifiers) {
    NSMutableArray<NSString *> *out = [NSMutableArray array];
    for (const auto &id : identifiers) {
      [out addObject:ns(id)];
    }
    return out;
  }

  void setBadgeNow(int count) {
    badge_ = count;
    std::string label = badgeLabel(count);
    NSApp.dockTile.badgeLabel = label.empty() ? nil : ns(label);
  }

  bool canPost_{false};
  std::atomic<int> badge_{0};
  NGNNotificationDelegate *delegate_ = nil;
};

} // namespace

std::shared_ptr<NotificationCenter> makeNotificationCenter(std::shared_ptr<NotificationEvents> events) {
  return std::make_shared<AppKitNotificationCenter>(std::move(events));
}

} // namespace ngn::appkit
