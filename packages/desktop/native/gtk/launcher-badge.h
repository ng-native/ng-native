// The Notifications badge on Linux: the count goes out as the com.canonical.Unity.LauncherEntry
// `Update` signal for the app's desktop entry, `application://<app id>.desktop`, best effort. KDE
// Plasma's task manager and Ubuntu's dock show it; stock GNOME shows nothing. It is the
// `showBadge` the notification centre (notifications.h) takes.
#pragma once

#include <functional>
#include <string>

namespace ngn::gtk {

inline constexpr const char *kLauncherEntryInterface = "com.canonical.Unity.LauncherEntry";

// The desktop entry the signal names.
std::string launcherEntryUri(const std::string &appId);

// Sends the count each time it is called, so a dock that starts later hears the next one: no dock
// asks for it.
std::function<void(int count)> makeLauncherBadge(const std::string &appId);

} // namespace ngn::gtk
