#include "ngn/posix-locale.h"

#include <doctest/doctest.h>

using Tags = std::vector<std::string>;

TEST_CASE("a POSIX locale name becomes a BCP 47 tag") {
  CHECK(ngn::languageTagOf("en_GB.UTF-8") == "en-GB");
  CHECK(ngn::languageTagOf("de") == "de");
  CHECK(ngn::languageTagOf("pt_br.utf8") == "pt-BR");
  CHECK(ngn::languageTagOf("sr_RS@latin") == "sr-Latn-RS");
  CHECK(ngn::languageTagOf("uz_UZ.UTF-8@cyrillic") == "uz-Cyrl-UZ");
  CHECK(ngn::languageTagOf("ca_ES.UTF-8@valencia") == "ca-ES-valencia");
  CHECK(ngn::languageTagOf("de_DE@euro") == "de-DE");
  CHECK_FALSE(ngn::languageTagOf("C"));
  CHECK_FALSE(ngn::languageTagOf("C.UTF-8"));
  CHECK_FALSE(ngn::languageTagOf("POSIX"));
  CHECK_FALSE(ngn::languageTagOf(""));
}

TEST_CASE("the preferred languages are LANGUAGE's, then the messages locale's") {
  CHECK(ngn::preferredLanguageTags("de_CH:fr:en_GB", "en_GB.UTF-8") == Tags{"de-CH", "fr", "en-GB"});
  CHECK(ngn::preferredLanguageTags("", "fr_FR.UTF-8") == Tags{"fr-FR"});
  // glibc ignores LANGUAGE under the C locale.
  CHECK(ngn::preferredLanguageTags("de", "C.UTF-8").empty());
  CHECK(ngn::preferredLanguageTags("::de::C", "de_DE.UTF-8") == Tags{"de", "de-DE"});
}

TEST_CASE("the region of a locale name") {
  CHECK(ngn::regionOfLocale("en_GB.UTF-8") == "GB");
  CHECK(ngn::regionOfLocale("de") == "");
  CHECK(ngn::regionOfLocale("C.UTF-8") == "");
}

TEST_CASE("right-to-left languages") {
  CHECK(ngn::rightToLeftLanguage("ar-EG"));
  CHECK(ngn::rightToLeftLanguage("he"));
  CHECK(ngn::rightToLeftLanguage("fa_IR"));
  CHECK_FALSE(ngn::rightToLeftLanguage("en-GB"));
  CHECK_FALSE(ngn::rightToLeftLanguage("ku-Latn-TR"));
}

TEST_CASE("the first weekday from glibc's week-1stday and first_weekday") {
  // en_US: weeks start on 1997-11-30, a Sunday, and first_weekday 1 is that day.
  CHECK(ngn::firstWeekdayOf(19971130, 1) == 1);
  // en_GB and de_DE: the same date, and first_weekday 2, a Monday.
  CHECK(ngn::firstWeekdayOf(19971130, 2) == 2);
  // A locale that dates its weeks from 1997-12-01, a Monday.
  CHECK(ngn::firstWeekdayOf(19971201, 1) == 2);
  // ar_EG and fa_IR start on Saturday.
  CHECK(ngn::firstWeekdayOf(19971130, 7) == 7);
}

TEST_CASE("a 12-hour clock in LC_TIME's time format") {
  CHECK_FALSE(ngn::uses24HourClockIn("%r"));
  CHECK_FALSE(ngn::uses24HourClockIn("%I:%M:%S %p"));
  CHECK_FALSE(ngn::uses24HourClockIn("%-I.%M %p"));
  CHECK(ngn::uses24HourClockIn("%T"));
  CHECK(ngn::uses24HourClockIn("%H:%M:%S"));
  CHECK(ngn::uses24HourClockIn("%k.%M"));
}

TEST_CASE("the measurement system and temperature unit of a region") {
  CHECK(ngn::measurementSystemOf(2, "US") == "U.S.");
  CHECK(ngn::measurementSystemOf(1, "GB") == "U.K.");
  CHECK(ngn::measurementSystemOf(1, "DE") == "Metric");
  CHECK(ngn::temperatureUnitOf("US") == "fahrenheit");
  CHECK(ngn::temperatureUnitOf("GB") == "celsius");
  CHECK(ngn::temperatureUnitOf("") == "celsius");
}
