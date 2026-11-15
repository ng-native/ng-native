// NgNativeCrypto: what @ng-native/expo's Crypto calls on expo-crypto, over a CryptoSource, which the
// AppKit backend implements with CommonCrypto and the system's secure random source.
//
// - randomUUID(): a version 4 UUID, lowercase, as expo-crypto's.
// - getRandomBytes(count): {base64} of `count` secure random bytes, 0 to 1024 of them.
// - digestStringAsync(algorithm, text, {encoding}): the hash of the text's UTF-8, as hex
//   (the default) or base64.
// - digestAsync(algorithm, {base64}): the hash of the bytes, as {base64}.
// The algorithms are expo-crypto's names: SHA-1, SHA-256, SHA-384, SHA-512, MD2, MD4 and MD5. A
// sync call that cannot answer throws; an async one rejects. Bytes cross as {base64}; the JS
// adapter (desktop-crypto.ts) turns them into the Uint8Array and ArrayBuffer expo-crypto answers.
#pragma once

#include "ngn/native-module.h"

#include <memory>
#include <optional>
#include <string>

namespace ngn {

class CryptoSource {
 public:
  virtual ~CryptoSource() = default;
  // The raw digest of `bytes` by `algorithm` (expo-crypto's name), or nothing for a name it does
  // not know.
  virtual std::optional<std::string> digest(const std::string &algorithm, const std::string &bytes) = 0;
  // `count` bytes from the OS's secure random source. Throws std::runtime_error when it fails.
  virtual std::string randomBytes(size_t count) = 0;
};

// Sixteen random bytes as a version 4 UUID: the version and variant bits set, lowercase hex.
std::string uuidV4(std::string bytes);
std::string hexOf(const std::string &bytes);

std::shared_ptr<NativeModule> makeCryptoModule(std::shared_ptr<CryptoSource> source);

} // namespace ngn
