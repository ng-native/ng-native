// Local notifications and the Dock badge on the desktop: `NgNativeNotifications`, expo-notifications'
// methods over the OS's notification centre (UNUserNotificationCenter on macOS).
//
// The host contract:
// - getPermissionsAsync() and requestPermissionsAsync() answer Expo's permission response
//   `{ status: 'granted' | 'denied' | 'undetermined', granted, canAskAgain, expires: 'never' }`.
//   Only requestPermissionsAsync asks the user, and only while the answer is undetermined. A host
//   that cannot post notifications at all (a bare binary with no bundle identifier) answers denied
//   with canAskAgain false.
// - scheduleNotificationAsync({ identifier?, content, trigger }) resolves to the identifier.
//   `content` takes title, subtitle, body, data, sound (true or a name) and badge; `trigger` is
//   null (now), `{ type: 'timeInterval', seconds, repeats }`, `{ type: 'date', date }` (ms since
//   the epoch: a Date does not cross a TurboModule), `{ type: 'daily', hour, minute }`,
//   `{ type: 'weekly', weekday, hour, minute }` (weekday 1 is Sunday), `{ type: 'monthly', day,
//   hour, minute }`, `{ type: 'yearly', month, day, hour, minute }` (month 0 is January) or
//   `{ type: 'calendar', repeats, year?, month?, day?, weekday?, hour?, minute?, second? }`.
//   A trigger it cannot read rejects. Without permission (or where the build cannot post) it
//   resolves null and schedules nothing: the permission status says why.
// - getAllScheduledNotificationsAsync() answers `{ identifier, content, trigger }` with the trigger
//   as reported: `{ type: 'timeInterval', seconds, repeats }`, `{ type: 'date', value, repeats:
//   false }` or `{ type: 'calendar', repeats, dateComponents }`.
// - cancelScheduledNotificationAsync(id), cancelAllScheduledNotificationsAsync(),
//   getPresentedNotificationsAsync(), dismissNotificationAsync(id), dismissAllNotificationsAsync(),
//   getNextTriggerDateAsync(trigger) (ms or null), getLastNotificationResponseAsync().
// - getBadgeCountAsync() and setBadgeCountAsync(count): the Dock badge, the count as its label and
//   none at 0. It needs no permission. A delivered notification with `content.badge` sets it too.
// - `ngNativeNotifications` on DeviceEventEmitter: `{ type: 'received', notification }` as one is
//   delivered while the app runs, and `{ type: 'response', response }` when the user clicks one,
//   with `response = { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
//   notification }` and `notification = { date, request }`. A remote notification's request has
//   the trigger `{ type: 'push', payload }`, the APNs payload, as on iOS. `{ type: 'token', token }`
//   when the OS hands the app a new device token while it runs.
// - getDevicePushTokenAsync() registers with APNs and resolves `{ type: 'macos', data }`, the
//   token in hex, or rejects with why the OS refused (an app signed without the
//   `aps-environment` entitlement, or no network). unregisterForNotificationsAsync() unregisters.
#pragma once

#include "ngn/native-module.h"

#include <folly/dynamic.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace ngn {

struct NotificationTrigger {
  enum class Kind { Now, Interval, Date, Calendar, Push };
  Kind kind{Kind::Now};
  double seconds{0};
  // Date: ms since the epoch.
  double date{0};
  bool repeats{false};
  // Calendar: the components that must match, in the user's calendar and time zone. Months are
  // 1 to 12 and weekdays 1 (Sunday) to 7, as NSDateComponents has them.
  std::map<std::string, int> components;
  // Push: the APNs payload as it came.
  folly::dynamic payload = nullptr;
  bool operator==(const NotificationTrigger &) const = default;
};

struct NotificationRequest {
  std::string identifier;
  std::string title;
  std::string subtitle;
  std::string body;
  folly::dynamic data = folly::dynamic::object();
  // Empty for none, "default" for the default sound, or a sound's name.
  std::string sound;
  std::optional<int> badge;
  NotificationTrigger trigger;
};

// The request in `args[0]` (scheduleNotificationAsync's), or why it cannot be read.
std::variant<NotificationRequest, std::string> parseNotificationRequest(const folly::dynamic &request);
// The trigger alone (getNextTriggerDateAsync's argument).
std::variant<NotificationTrigger, std::string> parseNotificationTrigger(const folly::dynamic &trigger);
// As getAllScheduledNotificationsAsync reports it.
folly::dynamic notificationRequestJson(const NotificationRequest &request);
// The Dock badge's label for a count: none at 0 or below.
std::string badgeLabel(int count);

// A remote notification's request from its APNs payload: the alert's title, subtitle and body
// (an alert that is a string is the body), its sound and badge, and the payload as its trigger's.
NotificationRequest remoteNotificationRequest(const std::string &identifier, const folly::dynamic &payload);
// Whether a payload has nothing to show (no alert): the OS's notification centre never presents
// it, so the app hears it only from the application delegate.
bool silentPush(const folly::dynamic &payload);

enum class NotificationAuthorization { NotDetermined, Denied, Authorized };
folly::dynamic permissionResponse(NotificationAuthorization authorization, bool canPost);

// The OS's notification centre. Callbacks may come on any thread.
class NotificationCenter {
 public:
  virtual ~NotificationCenter() = default;
  // False where the process cannot post notifications at all.
  virtual bool canPost() = 0;
  virtual void authorization(std::function<void(NotificationAuthorization)> done) = 0;
  virtual void requestAuthorization(std::function<void(NotificationAuthorization)> done) = 0;
  virtual void add(const NotificationRequest &request, std::function<void(std::optional<std::string> error)> done) = 0;
  virtual void pending(std::function<void(std::vector<NotificationRequest>)> done) = 0;
  // Delivered ones with their delivery date (ms since the epoch).
  virtual void delivered(std::function<void(std::vector<std::pair<double, NotificationRequest>>)> done) = 0;
  virtual void removePending(const std::vector<std::string> &identifiers) = 0;
  virtual void removeAllPending() = 0;
  virtual void removeDelivered(const std::vector<std::string> &identifiers) = 0;
  virtual void removeAllDelivered() = 0;
  // When the trigger would next fire (ms), in the user's calendar; nothing if never.
  virtual std::optional<double> nextDate(const NotificationTrigger &trigger) = 0;
  virtual int badge() = 0;
  virtual void setBadge(int count) = 0;
};

// Registration with the OS's push service (APNs). Answers come to PushTokens.
class PushRegistrar {
 public:
  virtual ~PushRegistrar() = default;
  virtual void registerForRemoteNotifications() = 0;
  virtual void unregisterForRemoteNotifications() = 0;
};

class NotificationEvents;

// The device's push token: asked for once however many callers wait, answered from what the OS
// reported last, and its rolls sent out as `token` events. Any thread.
class PushTokens {
 public:
  using Answer = std::function<void(std::optional<std::string> token, std::string error)>;
  PushTokens(std::shared_ptr<PushRegistrar> registrar, std::shared_ptr<NotificationEvents> events);
  // The token in hex, registering first when there is none.
  void request(Answer answer);
  // The OS's answers to a registration.
  void registered(const std::string &deviceToken);
  void failed(const std::string &message);
  void unregister();

 private:
  std::shared_ptr<PushRegistrar> registrar_;
  std::shared_ptr<NotificationEvents> events_;
  std::mutex mutex_;
  std::optional<std::string> token_;
  std::vector<Answer> waiting_;
  bool registering_{false};
};

// A device token's bytes as the hex APNs servers are given.
std::string pushTokenHex(const std::string &deviceToken);
// Why a registration failed, said for the app: the missing entitlement named, with what to do.
std::string pushFailure(const std::string &message);

// What the backend reports as notifications arrive and are clicked, kept for the app's modules:
// the response that launched the app waits for getLastNotificationResponseAsync.
class NotificationEvents {
 public:
  void received(double date, const NotificationRequest &request);
  void responded(double date, const NotificationRequest &request);
  // A new device token, in hex, while the app runs.
  void tokenChanged(const std::string &token);
  std::optional<folly::dynamic> lastResponse() const;
  std::shared_ptr<void> listen(std::function<void(const folly::dynamic &event)> listener);

 private:
  void send(const folly::dynamic &event);
  mutable std::mutex mutex_;
  std::optional<folly::dynamic> lastResponse_;
  std::map<int, std::function<void(const folly::dynamic &)>> listeners_;
  int next_{0};
};

// `push` absent (a host that cannot register) rejects getDevicePushTokenAsync.
std::shared_ptr<NativeModule> makeNotificationsModule(
    std::shared_ptr<NotificationCenter> center,
    std::shared_ptr<NotificationEvents> events,
    std::shared_ptr<PushTokens> push = nullptr);

} // namespace ngn
