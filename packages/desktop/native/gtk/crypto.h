// The OS half of NgNativeCrypto on Linux (the core's crypto.h): GLib's GChecksum for SHA-1, SHA-256,
// SHA-384, SHA-512 and MD5, and the kernel's getrandom(2). GLib has no MD2 or MD4, for which digest
// answers nothing.
#pragma once

#include "ngn/crypto.h"

#include <memory>

namespace ngn::gtk {

std::shared_ptr<CryptoSource> makeCryptoSource();

} // namespace ngn::gtk
