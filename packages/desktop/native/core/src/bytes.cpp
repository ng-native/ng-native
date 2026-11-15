#include "ngn/bytes.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace ngn {

namespace {

constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int valueOf(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62;
  if (c == '/' || c == '_') return 63;
  return -1;
}

} // namespace

std::string base64Encode(const std::string &bytes) {
  std::string out;
  out.reserve((bytes.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < bytes.size(); i += 3) {
    uint32_t n = (uint8_t)bytes[i] << 16 | (uint8_t)bytes[i + 1] << 8 | (uint8_t)bytes[i + 2];
    out += kAlphabet[n >> 18 & 63];
    out += kAlphabet[n >> 12 & 63];
    out += kAlphabet[n >> 6 & 63];
    out += kAlphabet[n & 63];
  }
  if (i + 1 == bytes.size()) {
    uint32_t n = (uint8_t)bytes[i] << 16;
    out += kAlphabet[n >> 18 & 63];
    out += kAlphabet[n >> 12 & 63];
    out += "==";
  } else if (i + 2 == bytes.size()) {
    uint32_t n = (uint8_t)bytes[i] << 16 | (uint8_t)bytes[i + 1] << 8;
    out += kAlphabet[n >> 18 & 63];
    out += kAlphabet[n >> 12 & 63];
    out += kAlphabet[n >> 6 & 63];
    out += '=';
  }
  return out;
}

std::optional<std::string> base64Decode(const std::string &text) {
  std::string out;
  uint32_t buffer = 0;
  int bits = 0;
  size_t sextets = 0;
  size_t padding = 0;
  for (char c : text) {
    if (c == '\n' || c == '\r' || c == ' ') {
      continue;
    }
    if (c == '=') {
      padding++;
      continue;
    }
    int v = valueOf(c);
    if (v < 0 || padding > 0) {
      return std::nullopt;
    }
    buffer = buffer << 6 | v;
    bits += 6;
    sextets++;
    if (bits >= 8) {
      bits -= 8;
      out += static_cast<char>(buffer >> bits & 0xff);
    }
  }
  // One character left over holds no whole byte; padding, where there is any, fills the last
  // quantum exactly. Unpadded input is fine.
  if (sextets % 4 == 1 || (padding > 0 && ((sextets + padding) % 4 != 0 || padding > 2))) {
    return std::nullopt;
  }
  return out;
}

std::string BlobStore::store(std::string bytes) {
  std::lock_guard lock(mutex_);
  std::string id = "ngn-" + std::to_string(++next_);
  blobs_[id] = std::move(bytes);
  return id;
}

void BlobStore::put(const std::string &id, std::string bytes) {
  std::lock_guard lock(mutex_);
  blobs_[id] = std::move(bytes);
}

void BlobStore::release(const std::string &id) {
  std::lock_guard lock(mutex_);
  blobs_.erase(id);
}

std::optional<std::string> BlobStore::resolve(const folly::dynamic &blob) const {
  if (!blob.isObject() || !blob.count("blobId") || !blob["blobId"].isString()) {
    return std::nullopt;
  }
  std::lock_guard lock(mutex_);
  auto it = blobs_.find(blob["blobId"].asString());
  if (it == blobs_.end()) {
    return std::nullopt;
  }
  const std::string &bytes = it->second;
  // Clamped while still a double, so a negative, huge or NaN bound is never converted out of range.
  auto bound = [&](const char *name, size_t limit, size_t otherwise) {
    if (!blob.count(name) || !blob[name].isNumber()) {
      return otherwise;
    }
    double value = blob[name].asDouble();
    return std::isnan(value) ? size_t{0} : static_cast<size_t>(std::clamp(value, 0.0, static_cast<double>(limit)));
  };
  size_t offset = bound("offset", bytes.size(), 0);
  size_t size = bound("size", bytes.size() - offset, bytes.size() - offset);
  return bytes.substr(offset, size);
}

size_t BlobStore::count() const {
  std::lock_guard lock(mutex_);
  return blobs_.size();
}

std::string Utf8Chunker::push(std::string chunk) {
  std::string text = pending_ + std::move(chunk);
  pending_.clear();
  // Walk back over continuation bytes to the start of the last character.
  size_t end = text.size();
  size_t i = end;
  int continuation = 0;
  while (i > 0 && continuation < 4 && ((uint8_t)text[i - 1] & 0xC0) == 0x80) {
    i--;
    continuation++;
  }
  if (i > 0) {
    uint8_t lead = text[i - 1];
    size_t need = (lead & 0xE0) == 0xC0 ? 2 : (lead & 0xF0) == 0xE0 ? 3 : (lead & 0xF8) == 0xF0 ? 4 : 1;
    size_t have = end - (i - 1);
    if (need > 1 && have < need) {
      pending_ = text.substr(i - 1);
      text.resize(i - 1);
    }
  }
  return text;
}

std::string Utf8Chunker::finish() {
  std::string rest;
  rest.swap(pending_);
  return rest;
}

} // namespace ngn
