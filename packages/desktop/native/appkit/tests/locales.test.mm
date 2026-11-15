// The locale facts the AppKit backend reads from the system (desktop-expo.mm).
#include "../desktop-expo.h"

#include <doctest/doctest.h>

TEST_CASE("NSCalendar identifiers take expo-localization's CLDR names, the two Ethiopic eras apart") {
  using ngn::appkit::calendarName;
  CHECK(calendarName(NSCalendarIdentifierGregorian) == "gregorian");
  CHECK(calendarName(NSCalendarIdentifierEthiopicAmeteMihret) == "ethiopic");
  CHECK(calendarName(NSCalendarIdentifierEthiopicAmeteAlem) == "ethioaa");
  CHECK(calendarName(NSCalendarIdentifierIslamicUmmAlQura) == "islamic-umalqura");
  CHECK(calendarName(@"made-up") == "made-up");
}
