// The OS half of NgNativeCalendar (the core's calendar.h): EventKit. It asks for access only when
// the app's Info.plist has the usage string for it, and reads only with full access, so a build
// without the strings never shows a prompt, nor creates an EKEventStore.
#pragma once

#include "ngn/calendar.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<CalendarStore> makeCalendarStore();

} // namespace ngn::appkit
