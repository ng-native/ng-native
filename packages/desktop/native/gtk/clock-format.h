// GNOME's 12 or 24-hour clock (org.gnome.desktop.interface's clock-format), which the date
// picker's time follows: read through the settings portal and followed by its SettingChanged, or
// from GSettings where no portal answers and the schema is installed. With neither, or a value
// other than 12h and 24h, the answer is nothing and the locale's time format decides.
#pragma once

#include <gio/gio.h>

#include <functional>
#include <optional>

namespace ngn::gtk {

class ClockFormatWatcher {
 public:
  // `changed` hears the clock format once read and on each change, on the main context.
  // `connection` is the bus the portal is on: the session bus when null.
  explicit ClockFormatWatcher(std::function<void(std::optional<bool> twelveHour)> changed, GDBusConnection *connection = nullptr);
  ~ClockFormatWatcher();
  ClockFormatWatcher(const ClockFormatWatcher &) = delete;
  ClockFormatWatcher &operator=(const ClockFormatWatcher &) = delete;

 private:
  void start(GDBusConnection *connection);
  void read(const char *method);
  void readValue(GVariant *value);
  void readGSettings();

  std::function<void(std::optional<bool>)> changed_;
  GCancellable *cancellable_{nullptr};
  GDBusConnection *connection_{nullptr};
  guint subscription_{0};
  GSettings *settings_{nullptr};
};

} // namespace ngn::gtk
