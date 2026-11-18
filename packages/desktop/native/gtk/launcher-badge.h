// The Notifications badge on Linux (notifications.h's NotificationCenter): the count goes out as
// the com.canonical.Unity.LauncherEntry `Update` signal for the app's desktop entry,
// `application://<app id>.desktop`, best effort. KDE Plasma's task manager and Ubuntu's dock
// show it; stock GNOME shows nothing. Posting notifications is not here yet, so the
// centre cannot post: permissions read as denied and a scheduled notification resolves empty.
#pragma once

#include "ngn/notifications.h"

#include <memory>
#include <string>

namespace ngn::gtk {

inline constexpr const char *kLauncherEntryInterface = "com.canonical.Unity.LauncherEntry";

// The desktop entry the signal names.
std::string launcherEntryUri(const std::string &appId);

std::shared_ptr<NotificationCenter> makeLauncherBadgeNotifications(const std::string &appId);

} // namespace ngn::gtk
