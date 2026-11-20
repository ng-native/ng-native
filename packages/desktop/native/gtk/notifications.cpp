#include "notifications.h"

#include "portal.h"
#include "system-access.h"

#include "ngn/notification-schedule.h"

#include <atomic>
#include <cstdio>
#include <optional>

namespace ngn::gtk {

namespace {

constexpr const char *kPortal = "org.freedesktop.portal.Notification";

// What GNotification and the portal show as the body: the subtitle, if any, on a line above it, as
// neither has a subtitle of its own.
std::string bodyOf(const NotificationRequest &request) {
  if (request.subtitle.empty()) {
    return request.body;
  }
  return request.body.empty() ? request.subtitle : request.subtitle + "\n" + request.body;
}

NotificationSchedule::Clock glibClock() {
  return {
      .now = [] { return g_get_real_time() / 1000.0; },
      .after =
          [](double ms, std::function<void()> fn) {
            auto cancelled = std::make_shared<std::atomic<bool>>(false);
            struct Timer {
              std::function<void()> fn;
              std::shared_ptr<std::atomic<bool>> cancelled;
            };
            g_timeout_add_full(
                G_PRIORITY_DEFAULT, static_cast<guint>(ms),
                +[](gpointer data) -> gboolean {
                  auto *timer = static_cast<Timer *>(data);
                  if (!*timer->cancelled) {
                    timer->fn();
                  }
                  return G_SOURCE_REMOVE;
                },
                new Timer{std::move(fn), cancelled}, +[](gpointer data) { delete static_cast<Timer *>(data); });
            return std::function<void()>([cancelled] { *cancelled = true; });
          },
  };
}

class GtkNotificationCenter final : public NotificationCenter, public std::enable_shared_from_this<GtkNotificationCenter> {
 public:
  GtkNotificationCenter(GApplication *application, std::shared_ptr<NotificationEvents> events, std::function<void()> raise,
                        std::function<void(int)> showBadge)
      : application_(G_APPLICATION(g_object_ref(application))),
        events_(std::move(events)),
        raise_(std::move(raise)),
        showBadge_(std::move(showBadge)) {}

  ~GtkNotificationCenter() override {
    if (unsubscribe_) {
      unsubscribe_();
    }
    g_action_map_remove_action(G_ACTION_MAP(application_), kNotificationAction);
    g_object_unref(application_);
  }

  void start(const std::string &appData, NotificationSchedule::Clock clock) {
    std::weak_ptr<GtkNotificationCenter> weak = weak_from_this();
    g_mkdir_with_parents(appData.c_str(), 0700);
    schedule_ = std::make_unique<NotificationSchedule>(appData + "/notifications.json", std::move(clock), [weak](const NotificationRequest &request) {
      if (auto self = weak.lock()) {
        self->show(request);
      }
    });
    // A click on a GNotification, and on one shown before a launch, which D-Bus activation runs as
    // the app's action.
    GSimpleAction *action = g_simple_action_new(kNotificationAction, G_VARIANT_TYPE_STRING);
    g_signal_connect_data(
        action, "activate", G_CALLBACK(+[](GSimpleAction *, GVariant *parameter, gpointer data) {
          if (auto self = static_cast<std::weak_ptr<GtkNotificationCenter> *>(data)->lock()) {
            self->clicked(g_variant_get_string(parameter, nullptr));
          }
        }),
        new std::weak_ptr<GtkNotificationCenter>(weak), +[](gpointer data, GClosure *) { delete static_cast<std::weak_ptr<GtkNotificationCenter> *>(data); },
        GConnectFlags(0));
    g_action_map_add_action(G_ACTION_MAP(application_), G_ACTION(action));
    g_object_unref(action);
    // A click on one the portal showed, for an app it does not activate: ActionInvoked(id, action,
    // parameter).
    unsubscribe_ = portal::subscribe(kPortal, "ActionInvoked", [weak](GVariant *parameters) {
      if (!g_variant_is_of_type(parameters, G_VARIANT_TYPE("(ssav)"))) {
        return;
      }
      const gchar *id = nullptr, *name = nullptr;
      g_variant_get(parameters, "(&s&s@av)", &id, &name, nullptr);
      std::string action = name;
      if (auto self = weak.lock(); self && (action == kNotificationAction || action == std::string("app.") + kNotificationAction)) {
        self->clicked(id);
      }
    });
    schedule_->start();
  }

  bool canPost() override {
    return g_application_get_application_id(application_) != nullptr;
  }
  void authorization(std::function<void(NotificationAuthorization)> done) override {
    done(NotificationAuthorization::Authorized);
  }
  void requestAuthorization(std::function<void(NotificationAuthorization)> done) override {
    done(NotificationAuthorization::Authorized);
  }
  void add(const NotificationRequest &request, std::function<void(std::optional<std::string>)> done) override {
    if (!schedule_->add(request)) {
      done("The notification schedule could not be saved");
      return;
    }
    done(std::nullopt);
  }
  void pending(std::function<void(std::vector<NotificationRequest>)> done) override {
    done(schedule_->pending());
  }
  void delivered(std::function<void(std::vector<std::pair<double, NotificationRequest>>)> done) override {
    done(schedule_->delivered());
  }
  void removePending(const std::vector<std::string> &identifiers) override {
    schedule_->removePending(identifiers);
  }
  void removeAllPending() override {
    schedule_->removeAllPending();
  }
  void removeDelivered(const std::vector<std::string> &identifiers) override {
    withdraw(schedule_->removeDelivered(identifiers));
  }
  void removeAllDelivered() override {
    withdraw(schedule_->removeAllDelivered());
  }
  std::optional<double> nextDate(const NotificationTrigger &trigger) override {
    return firstFireDate(trigger, g_get_real_time() / 1000.0);
  }
  int badge() override {
    return badge_;
  }
  void setBadge(int count) override {
    badge_ = count;
    if (showBadge_) {
      showBadge_(count);
    }
  }

 private:
  // On the main context, as the schedule's timer fires.
  void show(const NotificationRequest &request) {
    if (request.badge) {
      setBadge(*request.badge);
    }
    auto shown = schedule_->deliveredOne(request.identifier);
    events_->received(shown ? shown->first : g_get_real_time() / 1000.0, request);
    GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(options, "{sv}", "title", g_variant_new_string(request.title.c_str()));
    g_variant_builder_add(options, "{sv}", "body", g_variant_new_string(bodyOf(request).c_str()));
    // Inside a sandbox the portal knows the app's id, and runs an `app.` action on the app through
    // D-Bus activation, launching it if it must. Outside one it may know none (xdg-desktop-portal
    // 1.12 does not), so a plain action, which it sends back as ActionInvoked.
    std::string action = insideFlatpak() ? std::string("app.") + kNotificationAction : kNotificationAction;
    g_variant_builder_add(options, "{sv}", "default-action", g_variant_new_string(action.c_str()));
    g_variant_builder_add(options, "{sv}", "default-action-target", g_variant_new_string(request.identifier.c_str()));
    std::weak_ptr<GtkNotificationCenter> weak = weak_from_this();
    portal::request(kPortal, "AddNotification", g_variant_new("(s)", request.identifier.c_str()), options, nullptr,
                    [weak, request](portal::Outcome outcome, GVariant *) {
                      if (auto self = weak.lock(); self && outcome != portal::Outcome::Done) {
                        self->sendNotification(request);
                      }
                    }, false);
  }

  // GLib's own: the portal inside a sandbox, else org.gtk.Notifications or
  // org.freedesktop.Notifications.
  void sendNotification(const NotificationRequest &request) {
    GNotification *notification = g_notification_new(request.title.c_str());
    auto body = bodyOf(request);
    if (!body.empty()) {
      g_notification_set_body(notification, body.c_str());
    }
    g_notification_set_default_action_and_target(notification, (std::string("app.") + kNotificationAction).c_str(), "s",
                                                  request.identifier.c_str());
    g_application_send_notification(application_, request.identifier.c_str(), notification);
    g_object_unref(notification);
  }

  // From the portal, or from GLib's notifications where it does not answer: GLib picks its server
  // once for the process, as it first sends or withdraws one.
  void withdraw(const std::vector<std::string> &identifiers) {
    std::weak_ptr<GtkNotificationCenter> weak = weak_from_this();
    for (const auto &id : identifiers) {
      portal::request(kPortal, "RemoveNotification", g_variant_new("(s)", id.c_str()), nullptr, nullptr,
                      [weak, id](portal::Outcome outcome, GVariant *) {
                        if (auto self = weak.lock(); self && outcome != portal::Outcome::Done) {
                          g_application_withdraw_notification(self->application_, id.c_str());
                        }
                      }, false);
    }
  }

  void clicked(const std::string &identifier) {
    if (auto shown = schedule_->deliveredOne(identifier)) {
      events_->responded(shown->first, shown->second);
    }
    if (raise_) {
      raise_();
    }
  }

  GApplication *application_;
  std::shared_ptr<NotificationEvents> events_;
  std::function<void()> raise_;
  std::function<void(int)> showBadge_;
  std::unique_ptr<NotificationSchedule> schedule_;
  std::function<void()> unsubscribe_;
  std::atomic<int> badge_{0};
};

} // namespace

std::shared_ptr<NotificationCenter> makeNotificationCenter(GApplication *application, const std::string &appData,
                                                           std::shared_ptr<NotificationEvents> events, std::function<void()> raise,
                                                           std::function<void(int)> showBadge) {
  auto center = std::make_shared<GtkNotificationCenter>(application, std::move(events), std::move(raise), std::move(showBadge));
  center->start(appData, glibClock());
  return center;
}

} // namespace ngn::gtk
