// SecureStore's secrets on Linux: the Secret Service (GNOME Keyring, KWallet) through libsecret,
// which inside a Flatpak keeps them through the Secret portal instead. Never a file: with no
// Secret Service to reach, there is no store and SecureStore is absent.
#pragma once

#include "ngn/desktop-expo.h"

#include <gio/gio.h>

#include <memory>
#include <string>

namespace ngn::gtk {

// Whether `bus` has a Secret Service running or one it can start (org.freedesktop.secrets).
bool secretServiceOn(GDBusConnection *bus);

// The app's secrets, under a schema named for `appId` with the attributes `service` and `key`;
// null when no Secret Service is reachable (outside a Flatpak) or libsecret is not built in (the
// dev loop on a Mac).
std::shared_ptr<SecretStore> makeSecretStore(const std::string &appId, bool flatpak);

} // namespace ngn::gtk
