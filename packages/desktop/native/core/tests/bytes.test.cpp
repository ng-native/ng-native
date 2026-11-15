#include "ngn/bytes.h"

#include <doctest/doctest.h>

#include <cmath>

using folly::dynamic;

TEST_CASE("base64 refuses a final character that holds no whole byte, and padding that does not fit") {
  CHECK(ngn::base64Decode("TWFu") == "Man");
  // Unpadded and URL-safe input is fine.
  CHECK(ngn::base64Decode("TWE") == "Ma");
  CHECK(ngn::base64Decode("TQ") == "M");
  CHECK(ngn::base64Decode("TWE=") == "Ma");
  CHECK(ngn::base64Decode("TQ==") == "M");
  CHECK_FALSE(ngn::base64Decode("TWFuA"));
  CHECK_FALSE(ngn::base64Decode("T"));
  CHECK_FALSE(ngn::base64Decode("TQ="));
  CHECK_FALSE(ngn::base64Decode("TWE=="));
  CHECK_FALSE(ngn::base64Decode("TWFu===="));
}

TEST_CASE("a blob's offset and size are clamped to its bytes, however far out of range") {
  ngn::BlobStore blobs;
  auto id = blobs.store("hello");
  auto read = [&](dynamic offset, dynamic size) {
    dynamic blob = dynamic::object("blobId", id);
    if (!offset.isNull()) {
      blob["offset"] = offset;
    }
    if (!size.isNull()) {
      blob["size"] = size;
    }
    return blobs.resolve(blob);
  };
  CHECK(read(1, 3) == "ell");
  CHECK(read(-1, nullptr) == "hello");
  CHECK(read(1e100, nullptr) == "");
  CHECK(read(1, 1e100) == "ello");
  CHECK(read(1, -5) == "");
  CHECK(read(NAN, NAN) == "");
  CHECK(read(nullptr, nullptr) == "hello");
}
