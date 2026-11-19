#include "location.h"

#include "portal.h"

#include <atomic>
#include <map>
#include <memory>
#include <string>

namespace ngn::gtk {

namespace {

using Authorization = LocationSource::Authorization;
using Fix = LocationSource::Fix;

constexpr const char *kLocation = "org.freedesktop.portal.Location";
// How long a single fix may take before it is given up.
constexpr guint kFixTimeoutSeconds = 30;

std::optional<double> known(GVariant *location, const char *key, double unknownBelow) {
  double value = 0;
  if (!g_variant_lookup(location, key, "d", &value) || value < unknownBelow) {
    return std::nullopt;
  }
  return value;
}

// LocationUpdated's a{sv}: the portal marks an unknown altitude with -DBL_MAX, and an unknown
// speed or heading with -1.
Fix fixOf(GVariant *location) {
  Fix fix;
  g_variant_lookup(location, "Latitude", "d", &fix.latitude);
  g_variant_lookup(location, "Longitude", "d", &fix.longitude);
  fix.accuracy = known(location, "Accuracy", 0);
  fix.altitude = known(location, "Altitude", -1e300);
  fix.speed = known(location, "Speed", 0);
  fix.heading = known(location, "Heading", 0);
  guint64 seconds = 0, micros = 0;
  if (g_variant_lookup(location, "Timestamp", "(tt)", &seconds, &micros)) {
    fix.timestamp = static_cast<double>(seconds) * 1000 + static_cast<double>(micros) / 1000;
  } else {
    fix.timestamp = static_cast<double>(g_get_real_time()) / 1000;
  }
  return fix;
}

class PortalLocation final : public LocationSource, public std::enable_shared_from_this<PortalLocation> {
 public:
  ~PortalLocation() override {
    if (unsubscribe_) {
      unsubscribe_();
    }
  }

  Authorization authorization() override {
    return static_cast<Authorization>(status_.load());
  }

  void requestAuthorization(std::function<void(Authorization)> done) override {
    if (authorization() != Authorization::NotDetermined) {
      done(authorization());
      return;
    }
    auto self = shared_from_this();
    onMain([self, done = std::move(done)] {
      // A session started and closed again: the portal asks, and remembers the answer itself.
      auto session = std::make_shared<std::string>();
      self->start(portalAccuracyOf(0), 0, session, [self, session, done](bool started, std::string) {
        if (started) {
          portal::closeSession(*session);
        }
        done(self->authorization());
      }, nullptr);
    });
  }

  void currentFix(double accuracy, std::function<void(std::optional<Fix>, std::string)> done) override {
    auto self = shared_from_this();
    onMain([self, accuracy, done = std::move(done)] {
      struct Shot {
        bool answered{false};
        std::string session;
        guint timeout{0};
        std::function<void(std::optional<Fix>, std::string)> done;
        // Drops the session's listener.
        std::function<void()> forget;
        void answer(std::optional<Fix> fix, std::string error) {
          if (answered) {
            return;
          }
          answered = true;
          forget();
          if (timeout != 0) {
            g_source_remove(timeout);
            timeout = 0;
          }
          if (!session.empty()) {
            portal::closeSession(session);
          }
          done(std::move(fix), std::move(error));
        }
      };
      auto shot = std::make_shared<Shot>();
      shot->done = done;
      auto session = std::make_shared<std::string>();
      shot->forget = [self, session] { self->fixes_.erase(*session); };
      self->start(portalAccuracyOf(accuracy), 0, session, [shot, session](bool started, std::string error) {
        shot->session = *session;
        if (!started) {
          shot->answer(std::nullopt, error);
          return;
        }
        auto *held = new std::shared_ptr<Shot>(shot);
        shot->timeout = g_timeout_add_seconds_full(G_PRIORITY_DEFAULT, kFixTimeoutSeconds, +[](gpointer data) -> gboolean {
          auto &shot = *static_cast<std::shared_ptr<Shot> *>(data);
          shot->timeout = 0;
          shot->answer(std::nullopt, "The location request timed out");
          return G_SOURCE_REMOVE;
        }, held, +[](gpointer data) { delete static_cast<std::shared_ptr<Shot> *>(data); });
      }, [shot](const Fix &fix) { shot->answer(fix, ""); });
    });
  }

  int watch(double accuracy, double distance, std::function<void(const Fix &)> fix) override {
    int id = ++next_;
    auto self = shared_from_this();
    onMain([self, id, accuracy, distance, fix = std::move(fix)] {
      auto session = std::make_shared<std::string>();
      self->watches_[id] = session;
      self->start(portalAccuracyOf(accuracy), distance, session, [self, id, session](bool started, std::string) {
        // Stopped before it started: it ends now.
        if (started && !self->watches_.count(id)) {
          portal::closeSession(*session);
        }
      }, fix);
    });
    return id;
  }

  void stopWatching(int handle) override {
    auto self = shared_from_this();
    onMain([self, handle] {
      auto it = self->watches_.find(handle);
      if (it == self->watches_.end()) {
        return;
      }
      if (!it->second->empty()) {
        portal::closeSession(*it->second);
        self->fixes_.erase(*it->second);
      }
      self->watches_.erase(it);
    });
  }

 private:
  static void onMain(std::function<void()> fn) {
    auto *heap = new std::function<void()>(std::move(fn));
    g_main_context_invoke(nullptr, +[](gpointer data) -> gboolean {
      std::unique_ptr<std::function<void()>> fn(static_cast<std::function<void()> *>(data));
      (*fn)();
      return G_SOURCE_REMOVE;
    }, heap);
  }

  // A session of the Location portal, its path into `session` as it is made: `started` hears
  // whether the portal started it (and so whether access was given), `fix` each update. Main context.
  void start(unsigned accuracy, double distance, std::shared_ptr<std::string> session, std::function<void(bool, std::string)> started,
             std::function<void(const Fix &)> fix) {
    if (!unsubscribe_) {
      std::weak_ptr<PortalLocation> weak = weak_from_this();
      unsubscribe_ = portal::subscribe(kLocation, "LocationUpdated", [weak](GVariant *parameters) {
        auto self = weak.lock();
        if (!self) {
          return;
        }
        const gchar *path = nullptr;
        GVariant *location = nullptr;
        g_variant_get(parameters, "(&o@a{sv})", &path, &location);
        auto it = self->fixes_.find(path);
        if (it != self->fixes_.end()) {
          auto heard = it->second;
          heard(fixOf(location));
        }
        g_variant_unref(location);
      });
    }
    GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
    static std::atomic<int> tokens{0};
    auto token = "ngnlocation" + std::to_string(++tokens);
    g_variant_builder_add(options, "{sv}", "session_handle_token", g_variant_new_string(token.c_str()));
    g_variant_builder_add(options, "{sv}", "distance-threshold", g_variant_new_uint32(distance > 0 ? static_cast<guint32>(distance) : 0));
    g_variant_builder_add(options, "{sv}", "time-threshold", g_variant_new_uint32(0));
    g_variant_builder_add(options, "{sv}", "accuracy", g_variant_new_uint32(accuracy));
    auto self = shared_from_this();
    portal::request(
        kLocation, "CreateSession", g_variant_new("()"), options, nullptr,
        [self, session, started, fix](portal::Outcome outcome, GVariant *) {
          if (outcome != portal::Outcome::Done || session->empty()) {
            if (outcome == portal::Outcome::Absent) {
              self->status_ = static_cast<int>(Authorization::Restricted);
            }
            started(false, outcome == portal::Outcome::Absent ? "No Location portal answers on this desktop" : "The location session could not be made");
            return;
          }
          if (fix) {
            self->fixes_[*session] = fix;
          }
          portal::parentHandle(portal::frontWindow(), [self, session, started](const std::string &handle, std::function<void()> drop) {
            portal::request(kLocation, "Start", g_variant_new("(os)", session->c_str(), handle.c_str()), g_variant_builder_new(G_VARIANT_TYPE_VARDICT),
                            nullptr, [self, session, started, drop](portal::Outcome outcome, GVariant *) {
                              drop();
                              bool ok = outcome == portal::Outcome::Done;
                              self->status_ = static_cast<int>(ok ? Authorization::Granted
                                                                  : outcome == portal::Outcome::Absent ? Authorization::Restricted
                                                                                                       : Authorization::Denied);
                              if (!ok) {
                                self->fixes_.erase(*session);
                                portal::closeSession(*session);
                              }
                              started(ok, ok ? "" : "Not authorized to use location services");
                            });
          });
        },
        false, [session](const std::string &path) { *session = path; });
  }

  std::atomic<int> status_{static_cast<int>(Authorization::NotDetermined)};
  std::atomic<int> next_{0};
  // Main context only.
  std::function<void()> unsubscribe_;
  std::map<std::string, std::function<void(const Fix &)>> fixes_;
  std::map<int, std::shared_ptr<std::string>> watches_;
};

} // namespace

unsigned portalAccuracyOf(double metres) {
  // The portal's levels: 1 country, 2 city, 3 neighbourhood, 4 street, 5 exact.
  if (metres <= 0 || metres <= 10) {
    return 5;
  }
  if (metres <= 100) {
    return 4;
  }
  if (metres <= 1000) {
    return 3;
  }
  if (metres <= 10000) {
    return 2;
  }
  return 1;
}

std::shared_ptr<LocationSource> makeLocationSource() {
  return std::make_shared<PortalLocation>();
}

} // namespace ngn::gtk
