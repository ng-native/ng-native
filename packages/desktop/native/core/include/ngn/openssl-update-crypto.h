// The Expo Updates client's hash and signature check (updates.h) over OpenSSL 3, for a host whose
// OS has no crypto library of its own to use: the GTK host links the system's libcrypto.so.3, which
// its libcurl links already. Only OpenSSL 3.0 calls, so the host runs on any 3.x
// (native/docker/glibc-floor.sh checks). Toolkit-free.
#pragma once

#include "ngn/updates.h"

#include <memory>

namespace ngn {

std::shared_ptr<UpdateCrypto> makeOpenSslUpdateCrypto();

} // namespace ngn
