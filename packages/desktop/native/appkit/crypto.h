// The OS half of NgNativeCrypto (the core's crypto.h): CommonCrypto's digests and
// SecRandomCopyBytes.
#pragma once

#include "ngn/crypto.h"

#include <memory>
#include <optional>
#include <string>

namespace ngn::appkit {

std::shared_ptr<CryptoSource> makeCryptoSource();

// CryptoSource::digest, fed to CommonCrypto `chunk` bytes at a time (at most 2^32 - 1, whatever is
// asked); digest uses 2^30, so inputs of 4 GiB and more are hashed whole.
std::optional<std::string> digestInChunks(const std::string &algorithm, const std::string &bytes, size_t chunk);

} // namespace ngn::appkit
