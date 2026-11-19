#include "crypto.h"

#include <glib.h>

#include <sys/random.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <map>
#include <stdexcept>

namespace ngn::gtk {

namespace {

// Up to `count` secure random bytes into `out`: how many, or -1 with errno set.
ssize_t secureRandom(char *out, size_t count) {
#ifdef __linux__
  return getrandom(out, count, 0);
#else
  // The dev loop on a Mac: getentropy, 256 bytes at most a call.
  size_t n = std::min<size_t>(256, count);
  return getentropy(out, n) == 0 ? static_cast<ssize_t>(n) : -1;
#endif
}

class GlibCrypto final : public CryptoSource {
 public:
  std::optional<std::string> digest(const std::string &algorithm, const std::string &bytes) override {
    static const std::map<std::string, GChecksumType> types{
        {"SHA-1", G_CHECKSUM_SHA1}, {"SHA-256", G_CHECKSUM_SHA256}, {"SHA-384", G_CHECKSUM_SHA384},
        {"SHA-512", G_CHECKSUM_SHA512}, {"MD5", G_CHECKSUM_MD5}};
    auto type = types.find(algorithm);
    if (type == types.end()) {
      return std::nullopt;
    }
    GChecksum *checksum = g_checksum_new(type->second);
    // Fed in chunks a gssize holds on every architecture.
    constexpr size_t chunk = size_t{1} << 30;
    for (size_t at = 0; at < bytes.size(); at += chunk) {
      g_checksum_update(checksum, reinterpret_cast<const guchar *>(bytes.data() + at),
                        static_cast<gssize>(std::min(chunk, bytes.size() - at)));
    }
    std::string out(static_cast<size_t>(g_checksum_type_get_length(type->second)), '\0');
    gsize length = out.size();
    g_checksum_get_digest(checksum, reinterpret_cast<guint8 *>(out.data()), &length);
    g_checksum_free(checksum);
    out.resize(length);
    return out;
  }

  std::string randomBytes(size_t count) override {
    std::string out(count, '\0');
    for (size_t filled = 0; filled < count;) {
      ssize_t n = secureRandom(out.data() + filled, count - filled);
      if (n < 0 && errno == EINTR) {
        continue;
      }
      if (n <= 0) {
        throw std::runtime_error("Crypto: the system's secure random source failed");
      }
      filled += static_cast<size_t>(n);
    }
    return out;
  }
};

} // namespace

std::shared_ptr<CryptoSource> makeCryptoSource() {
  return std::make_shared<GlibCrypto>();
}

} // namespace ngn::gtk
