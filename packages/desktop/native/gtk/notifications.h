// Local notifications on GTK (ngn/notifications.h): each shown through the Notification portal,
// or by GApplication's own GNotification (org.gtk.Notifications or org.freedesktop.Notifications)
// where no portal answers. Linux has no scheduler, so triggers fire from the core's
// NotificationSchedule, kept in the app's data folder. A click on one, by the portal's
// ActionInvoked or the app's `ngn-notification` action (which D-Bus activation runs on a launch),
// raises the app and is the response the app hears. There is no permission to ask for: an app with
// an application id posts, and the desktop's settings decide whether it shows. No push.
#pragma once

#include "ngn/notifications.h"

#include <gio/gio.h>

#include <functional>
#include <memory>
#include <string>

namespace ngn::gtk {

// The app's action a notification's click runs, with the notification's identifier.
inline constexpr const char *kNotificationAction = "ngn-notification";

// `raise` brings the app to the front, and `showBadge`, when given, draws the badge count where the
// desktop shows one (the launcher's). The schedule starts at once, so what came due while the app
// was closed shows as it launches.
std::shared_ptr<NotificationCenter> makeNotificationCenter(GApplication *application, const std::string &appData,
                                                           std::shared_ptr<NotificationEvents> events, std::function<void()> raise,
                                                           std::function<void(int count)> showBadge = {});

} // namespace ngn::gtk
