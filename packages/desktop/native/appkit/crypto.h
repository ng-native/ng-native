// The OS half of NgNativeCrypto (the core's crypto.h): CommonCrypto's digests and
// SecRandomCopyBytes.
#pragma once

#include "ngn/crypto.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<CryptoSource> makeCryptoSource();

} // namespace ngn::appkit
