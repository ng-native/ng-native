// What a POSIX system's locale settings (LANGUAGE, LC_MESSAGES, LANG and the C library's locale
// data) say, in the shapes Localization answers (desktop-expo.h): the parsing a backend on such a
// system shares, toolkit-free. The backend reads the settings; these only turn them into tags and
// facts.
#pragma once

#include <optional>
#include <string>
#include <vector>

namespace ngn {

// A POSIX locale name as a BCP 47 tag: "en_GB.UTF-8" is "en-GB", "sr_RS@latin" is "sr-Latn-RS",
// "ca_ES@valencia" is "ca-ES-valencia". Nothing for "C", "POSIX" or an empty name, which name no
// language.
std::optional<std::string> languageTagOf(const std::string &posixLocale);

// The user's languages, most preferred first, as tags: LANGUAGE's colon-separated list, as gettext
// reads it, else the messages locale. As in glibc, LANGUAGE counts only when the messages locale
// names a language. Repeats are dropped.
std::vector<std::string> preferredLanguageTags(const std::string &languageList, const std::string &messagesLocale);

// The region of a locale name ("en_GB.UTF-8" is "GB"), or empty.
std::string regionOfLocale(const std::string &posixLocale);

// Whether a language ("ar", "he-IL") is written right to left.
bool rightToLeftLanguage(const std::string &tag);

// The first day of the week, 1 for Sunday, from glibc's LC_TIME `week-1stday` (a date, 19971130 a
// Sunday) and `first_weekday` (1 for that day).
int firstWeekdayOf(unsigned weekFirstDay, int firstWeekday);

// Whether a strftime time format (LC_TIME's `t_fmt`) shows the hour on a 24-hour clock.
bool uses24HourClockIn(const std::string &timeFormat);

// LC_MEASUREMENT's `measurement` (1 metric, 2 US) as NSLocale says the system: "Metric", "U.S.",
// or "U.K." in the United Kingdom, whose roads keep miles.
std::string measurementSystemOf(int measurement, const std::string &region);

// The unit a region gives temperatures in: "fahrenheit" where CLDR says so, else "celsius".
std::string temperatureUnitOf(const std::string &region);

} // namespace ngn
