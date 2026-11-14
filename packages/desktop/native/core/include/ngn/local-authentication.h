// NgNativeLocalAuthentication: expo-local-authentication's calls over an Authenticator, which the
// AppKit backend implements with LAContext (Touch ID, the login password, an Apple Watch).
//
// - hasHardwareAsync, isEnrolledAsync, supportedAuthenticationTypesAsync (1 fingerprint, 2 face,
//   3 iris) and getEnrolledLevelAsync (0 none, 1 a password, 3 strong biometrics).
// - authenticateAsync({promptMessage, cancelLabel, fallbackLabel, disableDeviceFallback}):
//   {success: true}, or {success: false, error} with expo's iOS error names. The password stands
//   in for Touch ID unless disableDeviceFallback is set. With it set, a call Touch ID cannot answer
//   (none, nothing enrolled, locked out, the lid closed) fails at once, with no prompt.
// - cancelAuthenticate: ends the prompt in progress, which answers `app_cancel`.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class Authenticator {
 public:
  enum class Biometry { None, TouchId, FaceId, OpticId };

  // Why an evaluation failed, as LAError says it.
  enum class Failure {
    AuthenticationFailed,
    UserCancel,
    UserFallback,
    SystemCancel,
    AppCancel,
    PasscodeNotSet,
    BiometryNotAvailable,
    BiometryNotEnrolled,
    BiometryLockout,
    InvalidContext,
    NotInteractive,
    Other,
  };

  struct Facts {
    // The kind of biometry the Mac has, whether or not it can be used.
    Biometry biometry{Biometry::None};
    // Why it cannot be used now: nothing enrolled, locked out, or the lid closed (SystemCancel).
    // Nothing when it can.
    std::optional<Failure> biometryUnusable;
    bool passwordSet{false};
  };

  struct Request {
    std::string reason;
    // Nothing for the system's own titles; an empty fallback title hides the fallback button.
    std::optional<std::string> cancelTitle;
    std::optional<std::string> fallbackTitle;
    // Touch ID only, without the password as a fallback.
    bool biometricsOnly{false};
  };

  virtual ~Authenticator() = default;
  virtual Facts facts() = 0;
  // Answers once, on any thread: nothing on success.
  virtual void evaluate(const Request &request, std::function<void(std::optional<Failure>)> done) = 0;
  // Ends the evaluation in progress, if any.
  virtual void cancel() = 0;
};

// expo-local-authentication's name for a failure: "user_cancel", "lockout" and the rest.
std::string authenticationError(Authenticator::Failure failure);

std::shared_ptr<NativeModule> makeLocalAuthenticationModule(std::shared_ptr<Authenticator> authenticator);

} // namespace ngn
