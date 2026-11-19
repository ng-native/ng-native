#include "locales.h"

#include "ngn/posix-locale.h"

#include <glib.h>

#include <langinfo.h>
#include <locale.h>

#include <cstdint>
#include <cstdlib>
#include <functional>

namespace ngn::gtk {

namespace {

std::string env(const char *name) {
  const char *value = getenv(name);
  return value ? value : "";
}

// Reads `read` in the locale `category` is set to, through the C library's locale data; nothing
// where the system has no data for it (a container with only C.UTF-8) or no glibc to ask.
template <typename T>
std::optional<T> inLocale(const char *category, int mask, const std::function<T(locale_t)> &read) {
#ifdef __GLIBC__
  std::string name = localeOf(category);
  if (!languageTagOf(name)) {
    return std::nullopt;
  }
  locale_t locale = newlocale(mask, name.c_str(), static_cast<locale_t>(0));
  if (locale == static_cast<locale_t>(0)) {
    return std::nullopt;
  }
  T value = read(locale);
  freelocale(locale);
  return value;
#else
  return std::nullopt;
#endif
}

[[maybe_unused]] std::string trimmed(std::string text) {
  auto last = text.find_last_not_of(' ');
  return last == std::string::npos ? "" : text.substr(0, last + 1);
}

// GLib's name for the local zone ("Europe/London"), without a leading colon or zoneinfo path.
std::string localTimeZone() {
  GTimeZone *zone = g_time_zone_new_local();
  std::string name = g_time_zone_get_identifier(zone);
  g_time_zone_unref(zone);
  if (!name.empty() && name[0] == ':') {
    name.erase(0, 1);
  }
  if (auto at = name.find("zoneinfo/"); at != std::string::npos) {
    name.erase(0, at + 9);
  }
  return name;
}

class GlibcLocales final : public LocaleSource {
 public:
  std::vector<LocaleFacts> locales() override {
    std::string region = systemRegionCode();
    LocaleFacts formats{.measurementSystem = measurementSystemOf(1, region), .temperatureUnit = temperatureUnitOf(region)};
#ifdef __GLIBC__
    if (auto numbers = inLocale<std::pair<std::string, std::string>>("LC_NUMERIC", LC_NUMERIC_MASK, [](locale_t l) {
          return std::make_pair(std::string(nl_langinfo_l(RADIXCHAR, l)), std::string(nl_langinfo_l(THOUSEP, l)));
        })) {
      formats.decimalSeparator = numbers->first;
      formats.groupingSeparator = numbers->second;
    }
    if (auto money = inLocale<std::pair<std::string, std::string>>("LC_MONETARY", LC_MONETARY_MASK, [](locale_t l) {
          return std::make_pair(trimmed(nl_langinfo_l(INT_CURR_SYMBOL, l)), std::string(nl_langinfo_l(CURRENCY_SYMBOL, l)));
        })) {
      formats.currencyCode = money->first;
      formats.currencySymbol = money->second;
    }
    if (auto measurement = inLocale<int>("LC_MEASUREMENT", LC_MEASUREMENT_MASK, [](locale_t l) {
          return static_cast<int>(nl_langinfo_l(_NL_MEASUREMENT_MEASUREMENT, l)[0]);
        })) {
      formats.measurementSystem = measurementSystemOf(*measurement, region);
    }
#endif
    std::vector<LocaleFacts> out;
    for (const auto &tag : preferredLanguageTags(env("LANGUAGE"), localeOf("LC_MESSAGES"))) {
      auto facts = formats;
      facts.languageTag = tag;
      facts.rightToLeft = rightToLeftLanguage(tag);
      out.push_back(std::move(facts));
    }
    return out;
  }

  CalendarFacts calendars() override {
    CalendarFacts facts{.calendar = "gregorian", .timeZone = localTimeZone()};
#ifdef __GLIBC__
    if (auto time = inLocale<std::pair<bool, int>>("LC_TIME", LC_TIME_MASK, [](locale_t l) {
          auto weekStart = static_cast<unsigned>(reinterpret_cast<uintptr_t>(nl_langinfo_l(_NL_TIME_WEEK_1STDAY, l)));
          return std::make_pair(uses24HourClockIn(nl_langinfo_l(T_FMT, l)), firstWeekdayOf(weekStart, nl_langinfo_l(_NL_TIME_FIRST_WEEKDAY, l)[0]));
        })) {
      facts.uses24hourClock = time->first;
      facts.firstWeekday = time->second;
    }
#endif
    return facts;
  }
};

} // namespace

std::string localeOf(const char *category) {
  for (const char *name : {"LC_ALL", category, "LANG"}) {
    if (auto value = env(name); !value.empty()) {
      return value;
    }
  }
  return "";
}

std::shared_ptr<LocaleSource> makeLocaleSource() {
  return std::make_shared<GlibcLocales>();
}

std::string systemRegionCode() {
  return regionOfLocale(localeOf("LC_MONETARY"));
}

} // namespace ngn::gtk
