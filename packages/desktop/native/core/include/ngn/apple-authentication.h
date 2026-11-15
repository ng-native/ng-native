// NgNativeAppleAuthentication: expo-apple-authentication's native module on a desktop host, over an
// AppleIdProvider the AppKit backend implements with AuthenticationServices.
//
// - isAvailableAsync(): whether the app can sign in with Apple at all: its signature carries the
//   `com.apple.developer.applesignin` entitlement. A development host has none, so it answers false.
// - requestAsync({requestedScopes, requestedOperation, user, state, nonce}): Apple's sheet, and the
//   credential in expo's shape: {user, email, fullName, realUserStatus, state, authorizationCode,
//   identityToken}. It rejects as `CODE: message` with expo's codes: an unknown scope or operation
//   (ERR_INVALID_SCOPE, ERR_INVALID_OPERATION), no entitlement (ERR_REQUEST_NOT_HANDLED, without
//   asking AuthenticationServices), `noPrompts` (ERR_REQUEST_NOT_INTERACTIVE, with no sheet), and
//   each ASAuthorizationError as on iOS.
// - getCredentialStateAsync(user): 0 revoked, 1 authorized, 2 not found, 3 transferred.
// - formatFullName(fullName, style): the name for the user's locale, in `default`, `short`,
//   `medium`, `long` or `abbreviated` style. Synchronous.
// The OS's word that the user revoked the app's credential arrives as an `ngNativeAppleAuthentication`
// event, {type: 'revoked'}.
//
// `<apple-sign-in-button>` is expo's button view (ViewManagerAdapter_ExpoAppleAuthentication), a
// Fabric component of the desktop's own that the AppKit backend draws as ASAuthorizationAppleIDButton,
// with expo's `buttonType`, `buttonStyle` and `cornerRadius`, sending `buttonPress` on a click.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/native-module.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class AppleIdProvider {
 public:
  enum class CredentialState { Revoked = 0, Authorized = 1, NotFound = 2, Transferred = 3 };
  enum class Scope { FullName = 0, Email = 1 };
  // ASAuthorization's OpenID operations, by expo's numbers.
  enum class Operation { Implicit = 0, Login = 1, Refresh = 2, Logout = 3 };

  struct Name {
    std::optional<std::string> namePrefix;
    std::optional<std::string> givenName;
    std::optional<std::string> middleName;
    std::optional<std::string> familyName;
    std::optional<std::string> nameSuffix;
    std::optional<std::string> nickname;
  };

  struct Request {
    std::vector<Scope> scopes;
    Operation operation{Operation::Implicit};
    std::optional<std::string> user;
    std::optional<std::string> state;
    std::optional<std::string> nonce;
  };

  struct Credential {
    std::optional<std::string> user;
    std::optional<std::string> email;
    std::optional<Name> fullName;
    // expo's: 1 unknown, 2 likely real, 3 unsupported.
    int realUserStatus{3};
    std::optional<std::string> state;
    std::optional<std::string> authorizationCode;
    std::optional<std::string> identityToken;
  };

  // ASAuthorizationError's codes.
  enum class Failure { Unknown, Canceled, InvalidResponse, NotHandled, Failed, NotInteractive, MatchedExcludedCredential, NoWindow };

  virtual ~AppleIdProvider() = default;
  // Whether the app is signed with the Sign in with Apple entitlement.
  virtual bool entitled() = 0;
  // Shows Apple's sheet over the key window and answers once, on any thread.
  virtual void perform(const Request &request, std::function<void(std::optional<Credential>, Failure)> done) = 0;
  virtual void credentialState(const std::string &user, std::function<void(CredentialState)> done) = 0;
  // `style` is expo's: default, short, medium, long or abbreviated.
  virtual std::string formatName(const Name &name, const std::string &style) = 0;
  // Calls `revoked`, on any thread, each time the OS says the app's credential was revoked, until
  // the function it answers is called.
  virtual std::function<void()> watchRevocations(std::function<void()> revoked) = 0;
};

// expo's `CODE: message` for a failure, as ExpoModulesCore names its exceptions on iOS.
std::string appleAuthenticationFailure(AppleIdProvider::Failure failure);

std::shared_ptr<NativeModule> makeAppleAuthenticationModule(std::shared_ptr<AppleIdProvider> provider, bool noPrompts);

extern const char AppleButtonComponentName[];

class AppleButtonProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  AppleButtonProps() = default;
  AppleButtonProps(
      const facebook::react::PropsParserContext &context,
      const AppleButtonProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // expo's enums, which are AuthenticationServices' own: sign in 0, continue 1, sign up 2; white 0,
  // white outline 1, black 2. Out of range is the default, as on iOS.
  int buttonType{0};
  int buttonStyle{0};
  // In points; expo sets 0 when none is given.
  double cornerRadius{0};
};

using AppleButtonShadowNode =
    facebook::react::ConcreteViewShadowNode<AppleButtonComponentName, AppleButtonProps, facebook::react::ViewEventEmitter>;
using AppleButtonComponentDescriptor = facebook::react::ConcreteComponentDescriptor<AppleButtonShadowNode>;

} // namespace ngn
