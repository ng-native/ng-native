#include "secret-store.h"

#ifdef NGN_LIBSECRET
#include <libsecret/secret.h>
#endif

#include <stdexcept>

namespace ngn::gtk {

std::string secretLabel(const std::string &appId, const std::string &service, const std::string &key) {
  // SecureStore's default service is the app's id, which the label already starts with.
  if (service.empty() || service == appId) {
    return appId + " " + key;
  }
  return appId + " " + service + " " + key;
}

namespace {

bool listed(GVariant *names, const char *name) {
  if (!names) {
    return false;
  }
  GVariantIter *iter = nullptr;
  const gchar *each = nullptr;
  bool found = false;
  g_variant_get(names, "(as)", &iter);
  while (!found && g_variant_iter_next(iter, "&s", &each)) {
    found = g_strcmp0(each, name) == 0;
  }
  g_variant_iter_free(iter);
  g_variant_unref(names);
  return found;
}

#ifdef NGN_LIBSECRET

class LibsecretStore final : public SecretStore {
 public:
  explicit LibsecretStore(std::string appId) : name_(std::move(appId)) {
    schema_ = {.name = name_.c_str(),
               .flags = SECRET_SCHEMA_NONE,
               .attributes = {{"service", SECRET_SCHEMA_ATTRIBUTE_STRING},
                              {"key", SECRET_SCHEMA_ATTRIBUTE_STRING},
                              {nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING}}};
  }

  std::optional<std::string> get(const std::string &service, const std::string &key) override {
    GError *error = nullptr;
    gchar *value = secret_password_lookup_sync(&schema_, nullptr, &error, "service", service.c_str(), "key", key.c_str(), nullptr);
    fail(error);
    if (!value) {
      return std::nullopt;
    }
    std::string out = value;
    secret_password_free(value);
    return out;
  }

  void set(const std::string &service, const std::string &key, const std::string &value) override {
    GError *error = nullptr;
    auto label = secretLabel(name_, service, key);
    secret_password_store_sync(&schema_, SECRET_COLLECTION_DEFAULT, label.c_str(), value.c_str(), nullptr, &error, "service",
                               service.c_str(), "key", key.c_str(), nullptr);
    fail(error);
  }

  void remove(const std::string &service, const std::string &key) override {
    GError *error = nullptr;
    secret_password_clear_sync(&schema_, nullptr, &error, "service", service.c_str(), "key", key.c_str(), nullptr);
    fail(error);
  }

 private:
  // A locked keyring the user would not unlock, or a Secret Service that went away.
  static void fail(GError *error) {
    if (error) {
      std::string message = error->message;
      g_error_free(error);
      throw std::runtime_error(message);
    }
  }

  std::string name_;
  SecretSchema schema_{};
};

#endif

} // namespace

bool secretServiceOn(GDBusConnection *bus) {
  if (!bus) {
    return false;
  }
  auto names = [bus](const char *method) {
    return g_dbus_connection_call_sync(bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", method,
                                       nullptr, G_VARIANT_TYPE("(as)"), G_DBUS_CALL_FLAGS_NONE, 2000, nullptr, nullptr);
  };
  return listed(names("ListNames"), "org.freedesktop.secrets") || listed(names("ListActivatableNames"), "org.freedesktop.secrets");
}

std::shared_ptr<SecretStore> makeSecretStore(const std::string &appId, bool flatpak) {
#ifdef NGN_LIBSECRET
  if (!flatpak) {
    GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
    bool on = secretServiceOn(bus);
    g_clear_object(&bus);
    if (!on) {
      return nullptr;
    }
  }
  return std::make_shared<LibsecretStore>(appId);
#else
  return nullptr;
#endif
}

} // namespace ngn::gtk
