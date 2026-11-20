#include "ngn/openssl-update-crypto.h"

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>
#include <openssl/x509.h>

#include <stdexcept>

namespace ngn {

namespace {

template <typename T, void (*Free)(T *)>
struct Freer {
  void operator()(T *p) const {
    Free(p);
  }
};
template <typename T, void (*Free)(T *)>
using Owned = std::unique_ptr<T, Freer<T, Free>>;

void freeBio(BIO *bio) {
  BIO_free(bio);
}

class OpenSslUpdateCrypto final : public UpdateCrypto {
 public:
  std::string sha256(const std::string &bytes) override {
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    if (EVP_Digest(bytes.data(), bytes.size(), digest, &length, EVP_sha256(), nullptr) != 1) {
      ERR_clear_error();
      throw std::runtime_error("OpenSSL could not hash with SHA-256");
    }
    return std::string(reinterpret_cast<const char *>(digest), length);
  }

  bool verifyRsaSha256(const std::string &certificatePem, const std::string &data, const std::string &signature) override {
    bool valid = verify(certificatePem, data, signature);
    // A failure leaves its reasons on this thread's queue, which a later call would misread.
    ERR_clear_error();
    return valid;
  }

 private:
  static bool verify(const std::string &certificatePem, const std::string &data, const std::string &signature) {
    if (signature.empty()) {
      return false;
    }
    Owned<BIO, freeBio> bio(BIO_new_mem_buf(certificatePem.data(), static_cast<int>(certificatePem.size())));
    if (!bio) {
      return false;
    }
    Owned<X509, X509_free> certificate(PEM_read_bio_X509(bio.get(), nullptr, nullptr, nullptr));
    if (!certificate) {
      return false;
    }
    Owned<EVP_PKEY, EVP_PKEY_free> key(X509_get_pubkey(certificate.get()));
    // RSASSA-PKCS1-v1_5 only, as the protocol's `rsa-v1_5-sha256` and macOS's check have it: a
    // certificate for another kind of key verifies nothing.
    if (!key || EVP_PKEY_get_base_id(key.get()) != EVP_PKEY_RSA) {
      return false;
    }
    Owned<EVP_MD_CTX, EVP_MD_CTX_free> context(EVP_MD_CTX_new());
    EVP_PKEY_CTX *keyContext = nullptr;
    return context && EVP_DigestVerifyInit(context.get(), &keyContext, EVP_sha256(), nullptr, key.get()) == 1 &&
        EVP_PKEY_CTX_set_rsa_padding(keyContext, RSA_PKCS1_PADDING) == 1 &&
        EVP_DigestVerify(
            context.get(), reinterpret_cast<const unsigned char *>(signature.data()), signature.size(),
            reinterpret_cast<const unsigned char *>(data.data()), data.size()) == 1;
  }
};

} // namespace

std::shared_ptr<UpdateCrypto> makeOpenSslUpdateCrypto() {
  return std::make_shared<OpenSslUpdateCrypto>();
}

} // namespace ngn
