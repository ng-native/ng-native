// The part of OpenSSL's <openssl/sha.h> React Native's DevServerHelper calls, over the system's
// SHA-256 (CommonCrypto on Apple platforms). See cmake/runtime-dependencies.cmake.
#pragma once

#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>

#define SHA256_DIGEST_LENGTH CC_SHA256_DIGEST_LENGTH
using SHA256_CTX = CC_SHA256_CTX;

inline int SHA256_Init(SHA256_CTX *context) {
  return CC_SHA256_Init(context);
}
inline int SHA256_Update(SHA256_CTX *context, const void *data, size_t length) {
  return CC_SHA256_Update(context, data, static_cast<CC_LONG>(length));
}
inline int SHA256_Final(unsigned char *digest, SHA256_CTX *context) {
  return CC_SHA256_Final(digest, context);
}
#else
#error "No SHA-256 shim for this OS yet: the desktop host's runtime builds on macOS only."
#endif
