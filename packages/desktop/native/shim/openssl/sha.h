// The part of OpenSSL's <openssl/sha.h> React Native's DevServerHelper calls: over the system's
// SHA-256 on Apple platforms (CommonCrypto), and elsewhere a portable SHA-256 (FIPS 180-4), since
// one device-id hash is no reason to link a crypto library. See cmake/runtime-dependencies.cmake.
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
#include <cstddef>
#include <cstdint>
#include <cstring>

#define SHA256_DIGEST_LENGTH 32

struct SHA256_CTX {
  uint32_t state[8];
  uint64_t length; // in bytes
  unsigned char block[64];
  size_t used;
};

namespace ngn::sha256 {

inline uint32_t rotr(uint32_t x, int n) {
  return (x >> n) | (x << (32 - n));
}

inline void compress(uint32_t state[8], const unsigned char *block) {
  static constexpr uint32_t k[64] = {
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = (uint32_t(block[4 * i]) << 24) | (uint32_t(block[4 * i + 1]) << 16) |
        (uint32_t(block[4 * i + 2]) << 8) | uint32_t(block[4 * i + 3]);
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t v[8];
  std::memcpy(v, state, sizeof v);
  for (int i = 0; i < 64; i++) {
    uint32_t t1 = v[7] + (rotr(v[4], 6) ^ rotr(v[4], 11) ^ rotr(v[4], 25)) +
        ((v[4] & v[5]) ^ (~v[4] & v[6])) + k[i] + w[i];
    uint32_t t2 = (rotr(v[0], 2) ^ rotr(v[0], 13) ^ rotr(v[0], 22)) +
        ((v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]));
    std::memmove(v + 1, v, 7 * sizeof v[0]);
    v[4] += t1;
    v[0] = t1 + t2;
  }
  for (int i = 0; i < 8; i++) {
    state[i] += v[i];
  }
}

} // namespace ngn::sha256

inline int SHA256_Init(SHA256_CTX *context) {
  static constexpr uint32_t initial[8] = {
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::memcpy(context->state, initial, sizeof initial);
  context->length = 0;
  context->used = 0;
  return 1;
}

inline int SHA256_Update(SHA256_CTX *context, const void *data, size_t length) {
  auto bytes = static_cast<const unsigned char *>(data);
  context->length += length;
  while (length > 0) {
    size_t n = sizeof context->block - context->used;
    if (n > length) {
      n = length;
    }
    std::memcpy(context->block + context->used, bytes, n);
    context->used += n;
    bytes += n;
    length -= n;
    if (context->used == sizeof context->block) {
      ngn::sha256::compress(context->state, context->block);
      context->used = 0;
    }
  }
  return 1;
}

inline int SHA256_Final(unsigned char *digest, SHA256_CTX *context) {
  uint64_t bits = context->length * 8;
  // A 1 bit, zeros up to 8 bytes short of a block, then the message's length in bits, big-endian.
  static constexpr unsigned char padding[64] = {0x80};
  size_t pad = context->used < 56 ? 56 - context->used : 120 - context->used;
  SHA256_Update(context, padding, pad);
  unsigned char length[8];
  for (int i = 0; i < 8; i++) {
    length[i] = static_cast<unsigned char>(bits >> (56 - 8 * i));
  }
  SHA256_Update(context, length, sizeof length);
  for (int i = 0; i < 8; i++) {
    digest[4 * i] = static_cast<unsigned char>(context->state[i] >> 24);
    digest[4 * i + 1] = static_cast<unsigned char>(context->state[i] >> 16);
    digest[4 * i + 2] = static_cast<unsigned char>(context->state[i] >> 8);
    digest[4 * i + 3] = static_cast<unsigned char>(context->state[i]);
  }
  return 1;
}
#endif
