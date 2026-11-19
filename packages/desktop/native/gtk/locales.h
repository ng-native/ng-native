// The OS half of NgNativeLocalization on Linux (the core's desktop-expo.h): the user's languages
// from LANGUAGE and the messages locale, and the formats from the C library's locale data for the
// locale each category names (LC_NUMERIC, LC_MONETARY, LC_MEASUREMENT, LC_TIME), as GNOME's and
// KDE's Formats settings set them. The time zone is GLib's local one.
#pragma once

#include "ngn/desktop-expo.h"

#include <memory>
#include <string>

namespace ngn::gtk {

// The locale a category is set to (`LC_TIME`, say): LC_ALL, then the category's own variable,
// then LANG, as the C library reads them. Empty when none is set.
std::string localeOf(const char *category);

std::shared_ptr<LocaleSource> makeLocaleSource();

// The region the formats are set to (LC_MONETARY's locale, "GB"), or empty.
std::string systemRegionCode();

} // namespace ngn::gtk
