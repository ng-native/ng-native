// The AppKit half of NgNativeAppleAuthentication (apple-authentication.mm) in the test binary, which
// is signed with no Sign in with Apple entitlement and has no window: the absent paths, the
// credential state, names and revocations. No sheet is ever shown.
#include "../apple-authentication.h"

#include <doctest/doctest.h>

#import <AuthenticationServices/AuthenticationServices.h>

#include <memory>
#include <mutex>
#include <optional>

using Provider = ngn::AppleIdProvider;

namespace {

template <typename Done>
void turnUntil(Done done, double seconds = 20) {
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while (!done() && [until timeIntervalSinceNow] > 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, false);
  }
}

} // namespace

TEST_CASE("Sign in with Apple is allowed only by the entitlement's Default, and this unsigned binary has none") {
  CHECK(ngn::appkit::allowsAppleSignIn(@[ @"Default" ]));
  CHECK_FALSE(ngn::appkit::allowsAppleSignIn(@[]));
  CHECK_FALSE(ngn::appkit::allowsAppleSignIn(nil));
  CHECK_FALSE(ngn::appkit::allowsAppleSignIn(@"Default"));
  CHECK_FALSE(ngn::appkit::makeAppleIdProvider()->entitled());
}

TEST_CASE("A request with no window to show the sheet on fails as iOS's does, and shows nothing") {
  auto provider = ngn::appkit::makeAppleIdProvider();
  std::optional<Provider::Failure> failed;
  bool answered = false;
  provider->perform({.scopes = {Provider::Scope::Email}, .operation = Provider::Operation::Login}, [&](auto credential, Provider::Failure failure) {
    answered = true;
    CHECK_FALSE(credential);
    failed = failure;
  });
  turnUntil([&] { return answered; });
  REQUIRE(failed);
  CHECK(*failed == Provider::Failure::NoWindow);
}

TEST_CASE("An unknown user's credential is not found") {
  auto provider = ngn::appkit::makeAppleIdProvider();
  // The answer can come on any thread, and after a timeout: it lands in shared, locked storage.
  struct Answer {
    std::mutex lock;
    std::optional<Provider::CredentialState> state;
  };
  auto answer = std::make_shared<Answer>();
  auto read = [answer] {
    std::lock_guard<std::mutex> hold(answer->lock);
    return answer->state;
  };
  provider->credentialState("000000.ngn-test-unknown-user.0000", [answer](Provider::CredentialState state) {
    std::lock_guard<std::mutex> hold(answer->lock);
    answer->state = state;
  });
  turnUntil([&] { return read().has_value(); });
  auto state = read();
  REQUIRE(state);
  CHECK(*state == Provider::CredentialState::NotFound);
}

TEST_CASE("A name is formatted by the system's formatter in the style asked") {
  auto provider = ngn::appkit::makeAppleIdProvider();
  Provider::Name ada{.givenName = "Ada", .familyName = "Lovelace"};
  auto full = provider->formatName(ada, "default");
  CHECK(full.find("Ada") != std::string::npos);
  CHECK(full.find("Lovelace") != std::string::npos);
  CHECK(provider->formatName(ada, "abbreviated") == "AL");
  // Short follows the user's short-name settings, so it is compared with the system's own.
  NSPersonNameComponents *components = [NSPersonNameComponents new];
  components.givenName = @"Ada";
  components.familyName = @"Lovelace";
  NSPersonNameComponentsFormatter *formatter = [NSPersonNameComponentsFormatter new];
  formatter.style = NSPersonNameComponentsFormatterStyleShort;
  CHECK(provider->formatName(ada, "short") == std::string([formatter stringFromPersonNameComponents:components].UTF8String));
  CHECK(provider->formatName({}, "default").empty());
}

TEST_CASE("The OS's revocation reaches the watcher until it stops watching") {
  auto provider = ngn::appkit::makeAppleIdProvider();
  int revoked = 0;
  auto stop = provider->watchRevocations([&] { revoked++; });
  [NSNotificationCenter.defaultCenter postNotificationName:ASAuthorizationAppleIDProviderCredentialRevokedNotification object:nil];
  CHECK(revoked == 1);
  stop();
  [NSNotificationCenter.defaultCenter postNotificationName:ASAuthorizationAppleIDProviderCredentialRevokedNotification object:nil];
  CHECK(revoked == 1);
}
