// The desktop notification centre (ngn/notifications.h) over UNUserNotificationCenter, and the
// Dock badge over NSDockTile. A process with no bundle identifier cannot use the notification
// centre at all: it then answers canPost() false and never touches it.
#pragma once

#include "ngn/notifications.h"

#include <memory>

namespace ngn::appkit {

// One for the process; its delegate is set at once, so a click that launched the app is kept.
std::shared_ptr<NotificationCenter> makeNotificationCenter(std::shared_ptr<NotificationEvents> events);

} // namespace ngn::appkit
