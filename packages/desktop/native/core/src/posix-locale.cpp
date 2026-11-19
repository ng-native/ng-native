#include "ngn/posix-locale.h"

#include <algorithm>
#include <cctype>
#include <set>

namespace ngn {

namespace {

std::string lower(std::string text) {
  for (auto &c : text) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return text;
}

std::string upper(std::string text) {
  for (auto &c : text) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return text;
}

struct LocaleName {
  std::string language;
  std::string region;
  std::string modifier;
};

// "ll_CC.codeset@modifier", each part after the language optional.
LocaleName partsOf(const std::string &name) {
  LocaleName parts;
  auto at = name.find('@');
  if (at != std::string::npos) {
    parts.modifier = name.substr(at + 1);
  }
  std::string base = name.substr(0, std::min(at, name.find('.')));
  auto underscore = base.find('_');
  parts.language = base.substr(0, underscore);
  if (underscore != std::string::npos) {
    parts.region = base.substr(underscore + 1);
  }
  return parts;
}

// The day of the week of a yyyymmdd date, 0 for Sunday (Sakamoto's method).
int weekdayOf(unsigned date) {
  int year = static_cast<int>(date / 10000), month = static_cast<int>(date / 100 % 100), day = static_cast<int>(date % 100);
  static const int offsets[] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
  if (month < 1 || month > 12) {
    return 0;
  }
  if (month < 3) {
    year -= 1;
  }
  return (year + year / 4 - year / 100 + year / 400 + offsets[month - 1] + day) % 7;
}

} // namespace

std::optional<std::string> languageTagOf(const std::string &posixLocale) {
  auto parts = partsOf(posixLocale);
  if (parts.language.empty() || parts.language == "C" || parts.language == "POSIX" ||
      !std::all_of(parts.language.begin(), parts.language.end(), [](char c) { return std::isalpha(static_cast<unsigned char>(c)); })) {
    return std::nullopt;
  }
  std::string tag = lower(parts.language);
  // The modifiers that name a script, and the one variant glibc's locales use; others (@euro) say
  // nothing a tag carries.
  auto modifier = lower(parts.modifier);
  if (modifier == "latin") {
    tag += "-Latn";
  } else if (modifier == "cyrillic") {
    tag += "-Cyrl";
  } else if (modifier == "devanagari") {
    tag += "-Deva";
  }
  if (!parts.region.empty()) {
    tag += "-" + upper(parts.region);
  }
  if (modifier == "valencia") {
    tag += "-valencia";
  }
  return tag;
}

std::vector<std::string> preferredLanguageTags(const std::string &languageList, const std::string &messagesLocale) {
  std::vector<std::string> tags;
  std::set<std::string> seen;
  auto add = [&](const std::string &name) {
    if (auto tag = languageTagOf(name); tag && seen.insert(*tag).second) {
      tags.push_back(*tag);
    }
  };
  if (languageTagOf(messagesLocale)) {
    size_t start = 0;
    while (start <= languageList.size()) {
      auto colon = languageList.find(':', start);
      add(languageList.substr(start, colon == std::string::npos ? std::string::npos : colon - start));
      if (colon == std::string::npos) {
        break;
      }
      start = colon + 1;
    }
  }
  add(messagesLocale);
  return tags;
}

std::string regionOfLocale(const std::string &posixLocale) {
  auto region = partsOf(posixLocale).region;
  return languageTagOf(posixLocale) ? upper(region) : "";
}

bool rightToLeftLanguage(const std::string &tag) {
  static const std::set<std::string> languages{"ar", "arc", "ckb", "dv", "fa", "he", "iw", "ks", "ku", "ps", "sd", "syr", "ug", "ur", "yi"};
  std::string language = lower(tag.substr(0, tag.find_first_of("-_")));
  // Kurdish and Sindhi in a Latin or Devanagari script run left to right.
  if (tag.find("-Latn") != std::string::npos || tag.find("-Deva") != std::string::npos) {
    return false;
  }
  return languages.count(language) > 0;
}

int firstWeekdayOf(unsigned weekFirstDay, int firstWeekday) {
  int base = weekdayOf(weekFirstDay);
  int day = std::clamp(firstWeekday, 1, 7);
  return (base + day - 1) % 7 + 1;
}

bool uses24HourClockIn(const std::string &timeFormat) {
  // %I and %r are the 12-hour clock's, %l a glibc extension of it; %H, %k, %R and %T the 24-hour.
  for (size_t i = 0; i + 1 < timeFormat.size(); ++i) {
    if (timeFormat[i] != '%') {
      continue;
    }
    char c = timeFormat[++i];
    // A flag or width (%-I, %_H) before the conversion.
    while ((c == '-' || c == '_' || c == '0' || c == '^' || c == '#' || c == 'E' || c == 'O') && i + 1 < timeFormat.size()) {
      c = timeFormat[++i];
    }
    if (c == 'I' || c == 'r' || c == 'l' || c == 'p' || c == 'P') {
      return false;
    }
  }
  return true;
}

std::string measurementSystemOf(int measurement, const std::string &region) {
  if (measurement == 2) {
    return "U.S.";
  }
  return region == "GB" ? "U.K." : "Metric";
}

std::string temperatureUnitOf(const std::string &region) {
  static const std::set<std::string> fahrenheit{"BS", "BZ", "KY", "PR", "PW", "US"};
  return fahrenheit.count(region) > 0 ? "fahrenheit" : "celsius";
}

} // namespace ngn
