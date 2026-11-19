#include "battery.h"

#include "dbus-properties.h"

#include <algorithm>
#include <string>
#include <vector>

namespace ngn::gtk {

namespace {

// UPower's device types and states (org.freedesktop.UPower.Device).
constexpr guint32 kBatteryType = 2;
constexpr guint32 kCharging = 1;
constexpr guint32 kFullyCharged = 4;
constexpr guint32 kPendingCharge = 5;

template <typename T>
std::optional<T> property(const DBusProperties &object, const char *name, const GVariantType *type, T (*read)(GVariant *)) {
  GVariant *value = object.get(name);
  if (!value) {
    return std::nullopt;
  }
  std::optional<T> out;
  if (g_variant_is_of_type(value, type)) {
    out = read(value);
  }
  g_variant_unref(value);
  return out;
}

std::optional<bool> boolean(const DBusProperties &object, const char *name) {
  return property<bool>(object, name, G_VARIANT_TYPE_BOOLEAN, [](GVariant *v) -> bool { return g_variant_get_boolean(v); });
}

std::optional<guint32> number(const DBusProperties &object, const char *name) {
  return property<guint32>(object, name, G_VARIANT_TYPE_UINT32, g_variant_get_uint32);
}

class UPowerSource final : public PowerSource {
 public:
  explicit UPowerSource(GDBusConnection *connection)
      : display_(G_BUS_TYPE_SYSTEM, connection, "org.freedesktop.UPower", "/org/freedesktop/UPower/devices/DisplayDevice",
                 "org.freedesktop.UPower.Device"),
        upower_(G_BUS_TYPE_SYSTEM, connection, "org.freedesktop.UPower", "/org/freedesktop/UPower", "org.freedesktop.UPower"),
        portal_(G_BUS_TYPE_SESSION, connection, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
                "org.freedesktop.portal.PowerProfileMonitor"),
        profiles_(G_BUS_TYPE_SYSTEM, connection, "net.hadess.PowerProfiles", "/net/hadess/PowerProfiles", "net.hadess.PowerProfiles") {}

  PowerFacts facts() override {
    PowerFacts facts;
    auto state = number(display_, "State").value_or(0);
    facts.hasBattery = boolean(display_, "IsPresent").value_or(false) && number(display_, "Type") == kBatteryType;
    if (facts.hasBattery) {
      GVariant *percentage = display_.get("Percentage");
      if (percentage && g_variant_is_of_type(percentage, G_VARIANT_TYPE_DOUBLE)) {
        facts.level = std::clamp(g_variant_get_double(percentage) / 100, 0.0, 1.0);
      }
      if (percentage) {
        g_variant_unref(percentage);
      }
      facts.charging = state == kCharging;
      facts.charged = state == kFullyCharged;
    }
    // On the adapter: UPower's own word, else what the battery's state says.
    auto onBattery = boolean(upower_, "OnBattery");
    facts.externalPower = onBattery ? !*onBattery : state == kCharging || state == kFullyCharged || state == kPendingCharge;
    facts.lowPowerMode = lowPower();
    return facts;
  }

  std::function<void()> watch(std::function<void()> changed) override {
    auto shared = std::make_shared<std::function<void()>>(std::move(changed));
    auto call = [shared] { (*shared)(); };
    std::vector<std::function<void()>> stops{display_.watch(call), upower_.watch(call), portal_.watch(call), profiles_.watch(call)};
    return [stops] {
      for (const auto &stop : stops) {
        stop();
      }
    };
  }

 private:
  // The portal's answer where it has one (a sandbox reaches no system service), else the daemon's.
  bool lowPower() {
    if (auto saver = boolean(portal_, "power-saver-enabled")) {
      return *saver;
    }
    GVariant *profile = profiles_.get("ActiveProfile");
    bool saver = profile && g_variant_is_of_type(profile, G_VARIANT_TYPE_STRING) && std::string(g_variant_get_string(profile, nullptr)) == "power-saver";
    if (profile) {
      g_variant_unref(profile);
    }
    return saver;
  }

  DBusProperties display_;
  DBusProperties upower_;
  DBusProperties portal_;
  DBusProperties profiles_;
};

} // namespace

std::shared_ptr<PowerSource> makePowerSource(GDBusConnection *connection) {
  return std::make_shared<UPowerSource>(connection);
}

} // namespace ngn::gtk
