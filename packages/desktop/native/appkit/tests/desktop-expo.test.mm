#include "../desktop-expo.h"

#include <doctest/doctest.h>

TEST_CASE("the Data Protection keychain is used when the app's signature has a Team ID and an app identity") {
  using ngn::appkit::usesDataProtectionKeychain;
  CHECK(usesDataProtectionKeychain("ABCDE12345", {"com.apple.application-identifier"}));
  CHECK(usesDataProtectionKeychain("ABCDE12345", {"keychain-access-groups"}));
  // Developer ID with no identity entitlement, ad hoc, and unsigned: the file keychain.
  CHECK_FALSE(usesDataProtectionKeychain("ABCDE12345", {"com.apple.security.device.camera"}));
  CHECK_FALSE(usesDataProtectionKeychain("", {"com.apple.application-identifier"}));
}
