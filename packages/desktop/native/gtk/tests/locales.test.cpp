// Localization on Linux: the languages from LANGUAGE and the messages locale, the formats from
// glibc's locale data for each category's locale. Needs glibc-langpack-en and -de (the CI image's).
// Off glibc (the macOS dev loop) the host reads no locale data, so the checks of what it gives are
// left out; the language tags, regions and counts do not read it.
#include "../host-sources.h"
#include "../locales.h"

#include "ngn/desktop-expo.h"

#include <doctest/doctest.h>
#include <glib.h>

#include <cstdlib>
#include <map>
#include <optional>
#include <string>

using folly::dynamic;

namespace {

// Sets the locale variables for the test's length, and restores what they were.
class LocaleEnvironment {
 public:
  explicit LocaleEnvironment(std::map<std::string, std::string> values) {
    for (const char *name : {"LANGUAGE", "LC_ALL", "LANG", "LC_MESSAGES", "LC_NUMERIC", "LC_MONETARY", "LC_MEASUREMENT", "LC_TIME"}) {
      const char *was = getenv(name);
      saved_[name] = was ? std::optional<std::string>(was) : std::nullopt;
      unsetenv(name);
    }
    for (const auto &[name, value] : values) {
      setenv(name.c_str(), value.c_str(), 1);
    }
  }
  ~LocaleEnvironment() {
    for (const auto &[name, value] : saved_) {
      if (value) {
        setenv(name.c_str(), value->c_str(), 1);
      } else {
        unsetenv(name.c_str());
      }
    }
  }

 private:
  std::map<std::string, std::optional<std::string>> saved_;
};

dynamic localesNow() {
  return ngn::makeLocalizationModule(ngn::gtk::makeLocaleSource(), ngn::gtk::systemRegionCode())->call("getLocales");
}

} // namespace

TEST_CASE("Localization lists LANGUAGE's languages, with the formats each category's locale sets") {
  LocaleEnvironment environment({
      {"LANG", "en_US.UTF-8"},
      {"LANGUAGE", "de_CH:en_GB"},
      {"LC_NUMERIC", "de_DE.UTF-8"},
      {"LC_MONETARY", "en_GB.UTF-8"},
      {"LC_MEASUREMENT", "en_GB.UTF-8"},
  });
  CHECK(ngn::gtk::systemRegionCode() == "GB");
  auto locales = localesNow();
  REQUIRE(locales.size() == 3);
  CHECK(locales[0]["languageTag"] == "de-CH");
  CHECK(locales[1]["languageTag"] == "en-GB");
  CHECK(locales[2]["languageTag"] == "en-US");
  for (const auto &locale : locales) {
#ifdef __GLIBC__
    CHECK(locale["decimalSeparator"] == ",");
    CHECK(locale["digitGroupingSeparator"] == ".");
    CHECK(locale["currencyCode"] == "GBP");
    CHECK(locale["currencySymbol"] == "£");
    CHECK(locale["measurementSystem"] == "uk");
#endif
    CHECK(locale["temperatureUnit"] == "celsius");
  }
}

TEST_CASE("Localization in the United States: dollars, US units, Fahrenheit and a 12-hour clock from Sunday") {
  LocaleEnvironment environment({{"LANG", "en_US.UTF-8"}});
  auto locales = localesNow();
  REQUIRE(locales.size() == 1);
  CHECK(locales[0]["languageTag"] == "en-US");
  CHECK(locales[0]["regionCode"] == "US");
#ifdef __GLIBC__
  CHECK(locales[0]["decimalSeparator"] == ".");
  CHECK(locales[0]["currencyCode"] == "USD");
  CHECK(locales[0]["currencySymbol"] == "$");
#endif
  CHECK(locales[0]["measurementSystem"] == "us");
  CHECK(locales[0]["temperatureUnit"] == "fahrenheit");
  auto calendar = ngn::gtk::makeLocaleSource()->calendars();
  CHECK(calendar.calendar == "gregorian");
#ifdef __GLIBC__
  CHECK_FALSE(calendar.uses24hourClock);
  CHECK(calendar.firstWeekday == 1);
#endif
}

TEST_CASE("Localization's calendar follows LC_TIME, apart from the language") {
  LocaleEnvironment environment({{"LANG", "en_US.UTF-8"}, {"LC_TIME", "de_DE.UTF-8"}});
  (void)environment;
#ifdef __GLIBC__
  auto calendar = ngn::gtk::makeLocaleSource()->calendars();
  CHECK(calendar.uses24hourClock);
  CHECK(calendar.firstWeekday == 2);
#endif
}

TEST_CASE("Localization under LC_ALL, and under the C locale") {
  {
    LocaleEnvironment environment({{"LANG", "en_US.UTF-8"}, {"LC_ALL", "de_DE.UTF-8"}, {"LANGUAGE", "fr"}});
    auto locales = localesNow();
    REQUIRE(locales.size() == 2);
    CHECK(locales[0]["languageTag"] == "fr");
    CHECK(locales[0]["regionCode"] == "DE");
    CHECK(locales[1]["languageTag"] == "de-DE");
#ifdef __GLIBC__
    CHECK(locales[1]["currencyCode"] == "EUR");
#endif
  }
  {
    // No language at all: English, with no region to put it in.
    LocaleEnvironment environment({{"LANG", "C.UTF-8"}, {"LANGUAGE", "de"}});
    auto locales = localesNow();
    REQUIRE(locales.size() == 1);
    CHECK(locales[0]["languageTag"] == "en");
  }
}

TEST_CASE("the system's locale for Platform is the most preferred language") {
  LocaleEnvironment environment({{"LANG", "en_GB.UTF-8"}, {"LANGUAGE", "sr_RS@latin:en"}});
  auto system = ngn::gtk::makeSystem("ngn.locales.test", g_get_tmp_dir());
  CHECK(system->facts().locale == "sr-Latn-RS");
}
