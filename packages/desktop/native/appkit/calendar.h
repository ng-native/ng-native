// The OS half of NgNativeCalendar (the core's calendar.h): EventKit. It asks for access only when
// the app's Info.plist has the usage string for it, and reads only with full access, so a build
// without the strings never shows a prompt, nor creates an EKEventStore.
#pragma once

#include "ngn/calendar.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<CalendarStore> makeCalendarStore();

} // namespace ngn::appkit

#ifdef __OBJC__
#import <EventKit/EventKit.h>

// What a create or an update writes onto an event or a reminder, and how one reads back, apart
// from the store: in memory, with no access needed.
void NGNApplyEventDetails(EKEvent *event, const ngn::CalendarStore::Details &details);
void NGNApplyReminderDetails(EKReminder *reminder, const ngn::CalendarStore::Details &details);
ngn::CalendarStore::Event NGNEventRecord(EKEvent *event);
ngn::CalendarStore::Reminder NGNReminderRecord(EKReminder *reminder);
#endif
