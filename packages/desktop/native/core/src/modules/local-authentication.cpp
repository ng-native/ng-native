#include "ngn/local-authentication.h"

namespace ngn {

namespace {

std::optional<std::string> optionalString(const folly::dynamic &options, const char *key) {
  if (!options.isObject()) {
    return std::nullopt;
  }
  auto it = options.find(key);
  if (it == options.items().end() || !it->second.isString()) {
    return std::nullopt;
  }
  return it->second.asString();
}

bool flag(const folly::dynamic &options, const char *key) {
  if (!options.isObject()) {
    return false;
  }
  auto it = options.find(key);
  return it != options.items().end() && it->second.isBool() && it->second.asBool();
}

folly::dynamic failed(const std::string &error) {
  return folly::dynamic::object("success", false)("error", error);
}

} // namespace

std::string authenticationError(Authenticator::Failure failure) {
  using F = Authenticator::Failure;
  switch (failure) {
    case F::AuthenticationFailed:
      return "authentication_failed";
    case F::UserCancel:
      return "user_cancel";
    case F::UserFallback:
      return "user_fallback";
    case F::SystemCancel:
      return "system_cancel";
    case F::AppCancel:
      return "app_cancel";
    case F::PasscodeNotSet:
      return "passcode_not_set";
    case F::BiometryNotAvailable:
      return "not_available";
    case F::BiometryNotEnrolled:
      return "not_enrolled";
    case F::BiometryLockout:
      return "lockout";
    case F::InvalidContext:
      return "invalid_context";
    case F::NotInteractive:
      return "not_interactive";
    case F::Other:
      break;
  }
  return "unknown";
}

std::shared_ptr<NativeModule> makeLocalAuthenticationModule(std::shared_ptr<Authenticator> authenticator) {
  struct LocalAuthentication : NativeModule {
    explicit LocalAuthentication(std::shared_ptr<Authenticator> mac) : NativeModule("NgNativeLocalAuthentication") {
      using Biometry = Authenticator::Biometry;
      promise("hasHardwareAsync", [mac](const folly::dynamic &, JsPromise promise) {
        promise.resolve(mac->facts().biometry != Biometry::None);
      });
      promise("isEnrolledAsync", [mac](const folly::dynamic &, JsPromise promise) {
        auto facts = mac->facts();
        promise.resolve(facts.biometry != Biometry::None && !facts.biometryUnusable);
      });
      promise("supportedAuthenticationTypesAsync", [mac](const folly::dynamic &, JsPromise promise) {
        folly::dynamic types = folly::dynamic::array();
        switch (mac->facts().biometry) {
          case Biometry::TouchId:
            types.push_back(1);
            break;
          case Biometry::FaceId:
            types.push_back(2);
            break;
          case Biometry::OpticId:
            types.push_back(3);
            break;
          case Biometry::None:
            break;
        }
        promise.resolve(std::move(types));
      });
      // expo's SecurityLevel: NONE 0, SECRET 1, BIOMETRIC_STRONG 3.
      promise("getEnrolledLevelAsync", [mac](const folly::dynamic &, JsPromise promise) {
        auto facts = mac->facts();
        promise.resolve(facts.biometry != Biometry::None && !facts.biometryUnusable ? 3 : facts.passwordSet ? 1 : 0);
      });
      promise("authenticateAsync", [mac](const folly::dynamic &args, JsPromise promise) {
        folly::dynamic options = args.empty() ? folly::dynamic(nullptr) : args[0];
        auto reason = optionalString(options, "promptMessage");
        if (!reason || reason->empty()) {
          promise.reject("LocalAuthentication.authenticateAsync: `options.promptMessage` must be a non-empty string.");
          return;
        }
        Authenticator::Request request{
            .reason = *reason,
            .cancelTitle = optionalString(options, "cancelLabel"),
            .fallbackTitle = optionalString(options, "fallbackLabel"),
            .biometricsOnly = flag(options, "disableDeviceFallback"),
        };
        if (request.biometricsOnly) {
          // As iOS: no "Enter Password" button unless the call names one.
          if (!request.fallbackTitle) {
            request.fallbackTitle = "";
          }
          auto facts = mac->facts();
          if (facts.biometry == Biometry::None) {
            promise.resolve(failed("not_available"));
            return;
          }
          if (facts.biometryUnusable) {
            promise.resolve(failed(authenticationError(*facts.biometryUnusable)));
            return;
          }
        }
        mac->evaluate(request, [promise](std::optional<Authenticator::Failure> failure) {
          promise.resolve(failure ? failed(authenticationError(*failure)) : folly::dynamic::object("success", true));
        });
      });
      promise("cancelAuthenticate", [mac](const folly::dynamic &, JsPromise promise) {
        mac->cancel();
        promise.resolve(nullptr);
      });
    }
  };
  return std::make_shared<LocalAuthentication>(std::move(authenticator));
}

} // namespace ngn
