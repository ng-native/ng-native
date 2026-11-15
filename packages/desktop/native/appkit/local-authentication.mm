// The OS half of NgNativeLocalAuthentication: Touch ID and the login password through LAContext,
// one context for each prompt so cancelAuthenticate can end it.
#import "local-authentication.h"

#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

#include <cstdlib>
#include <mutex>

namespace ngn::appkit {

namespace {

NSString *ns(const std::string &s) {
  NSString *out = [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];
  return out != nil ? out : @"";
}

Authenticator::Failure failureOf(NSError *error) {
  using F = Authenticator::Failure;
  if (![error.domain isEqualToString:LAErrorDomain]) {
    return F::Other;
  }
  switch (error.code) {
    case LAErrorAuthenticationFailed:
      return F::AuthenticationFailed;
    case LAErrorUserCancel:
      return F::UserCancel;
    case LAErrorUserFallback:
      return F::UserFallback;
    case LAErrorSystemCancel:
      return F::SystemCancel;
    case LAErrorAppCancel:
      return F::AppCancel;
    case LAErrorPasscodeNotSet:
      return F::PasscodeNotSet;
    case LAErrorBiometryNotAvailable:
      return F::BiometryNotAvailable;
    case LAErrorBiometryNotEnrolled:
      return F::BiometryNotEnrolled;
    case LAErrorBiometryLockout:
      return F::BiometryLockout;
    case LAErrorInvalidContext:
      return F::InvalidContext;
    case LAErrorNotInteractive:
      return F::NotInteractive;
    default:
      return F::Other;
  }
}

class LAAuthenticator final : public Authenticator {
 public:
  explicit LAAuthenticator(bool noPrompts) : noPrompts_(noPrompts) {}
  Facts facts() override {
    LAContext *context = [LAContext new];
    NSError *error = nil;
    Facts facts;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]) {
      facts.biometryUnusable = failureOf(error);
    }
    switch (context.biometryType) {
      case LABiometryTypeTouchID:
        facts.biometry = Biometry::TouchId;
        break;
      case LABiometryTypeFaceID:
        facts.biometry = Biometry::FaceId;
        break;
      default:
        if (@available(macOS 14.0, *)) {
          if (context.biometryType == LABiometryTypeOpticID) {
            facts.biometry = Biometry::OpticId;
          }
        }
        break;
    }
    facts.passwordSet = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil];
    return facts;
  }

  void evaluate(const Request &request, std::function<void(std::optional<Failure>)> done) override {
    LAContext *context = [LAContext new];
    if (request.cancelTitle) {
      context.localizedCancelTitle = ns(*request.cancelTitle);
    }
    if (request.fallbackTitle) {
      context.localizedFallbackTitle = ns(*request.fallbackTitle);
    }
    if (noPrompts_) {
      context.interactionNotAllowed = YES;
    }
    {
      std::lock_guard lock(mutex_);
      current_ = context;
    }
    auto policy = request.biometricsOnly ? LAPolicyDeviceOwnerAuthenticationWithBiometrics : LAPolicyDeviceOwnerAuthentication;
    [context evaluatePolicy:policy
            localizedReason:ns(request.reason)
                      reply:^(BOOL success, NSError *error) {
                        {
                          std::lock_guard lock(mutex_);
                          if (current_ == context) {
                            current_ = nil;
                          }
                        }
                        done(success ? std::nullopt : std::optional(failureOf(error)));
                      }];
  }

  void cancel() override {
    LAContext *context;
    {
      std::lock_guard lock(mutex_);
      context = current_;
    }
    [context invalidate];
  }

 private:
  bool noPrompts_;
  std::mutex mutex_;
  LAContext *current_{nil};
};

} // namespace

std::shared_ptr<Authenticator> makeAuthenticator(bool noPrompts) {
  return std::make_shared<LAAuthenticator>(noPrompts);
}

} // namespace ngn::appkit
