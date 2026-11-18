#include "ngn/system.h"

#include <folly/json.h>

namespace ngn {

ColorSchemeOverride::ColorSchemeOverride(std::string systemScheme) : system_(std::move(systemScheme)) {}

std::string ColorSchemeOverride::current() const {
  std::lock_guard lock(mutex_);
  return override_.value_or(system_);
}

void ColorSchemeOverride::set(std::optional<std::string> scheme) {
  std::lock_guard lock(mutex_);
  override_ = std::move(scheme);
}

void ColorSchemeOverride::systemChanged(std::string scheme) {
  std::lock_guard lock(mutex_);
  system_ = std::move(scheme);
}

std::string ColorSchemeOverride::applied(const std::optional<std::string> &scheme) const {
  std::lock_guard lock(mutex_);
  return scheme.value_or(system_);
}

JsonPreferences::JsonPreferences(std::shared_ptr<StringStore> store, const std::string &appId, bool sharedStore)
    : store_(std::move(store)), prefix_(sharedStore ? appId + "." : std::string{}) {}

std::optional<folly::dynamic> JsonPreferences::get(const std::string &key) const {
  auto json = store_->get(prefix_ + key);
  if (!json) {
    return std::nullopt;
  }
  try {
    return folly::parseJson(*json);
  } catch (...) {
    return std::nullopt;
  }
}

void JsonPreferences::set(const std::string &key, const std::optional<folly::dynamic> &value) const {
  if (value) {
    store_->set(prefix_ + key, folly::toJson(*value));
  } else {
    store_->remove(prefix_ + key);
  }
}

} // namespace ngn
