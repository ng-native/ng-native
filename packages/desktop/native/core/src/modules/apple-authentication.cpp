#include "ngn/apple-authentication.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/core/propsConversions.h>

#include <cstdint>

using folly::dynamic;

namespace ngn {

const char AppleButtonComponentName[] = "ViewManagerAdapter_ExpoAppleAuthentication";

namespace {

int enumOf(int value) {
  return value >= 0 && value <= 2 ? value : 0;
}

} // namespace

AppleButtonProps::AppleButtonProps(
    const facebook::react::PropsParserContext &context,
    const AppleButtonProps &sourceProps,
    const facebook::react::RawProps &rawProps)
    : facebook::react::ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      buttonType(enumOf(facebook::react::convertRawProp(context, rawProps, "buttonType", sourceProps.buttonType, 0))),
      buttonStyle(enumOf(facebook::react::convertRawProp(context, rawProps, "buttonStyle", sourceProps.buttonStyle, 0))),
      cornerRadius(facebook::react::convertRawProp(context, rawProps, "cornerRadius", sourceProps.cornerRadius, 0.0)) {}

namespace {

using Provider = AppleIdProvider;

std::optional<std::string> optionalText(const dynamic &object, const char *key) {
  if (!object.isObject()) {
    return std::nullopt;
  }
  const auto *value = object.get_ptr(key);
  return value && value->isString() ? std::optional(value->asString()) : std::nullopt;
}

dynamic orNull(const std::optional<std::string> &text) {
  return text ? dynamic(*text) : dynamic(nullptr);
}

Provider::Name nameOf(const dynamic &value) {
  return {
      .namePrefix = optionalText(value, "namePrefix"),
      .givenName = optionalText(value, "givenName"),
      .middleName = optionalText(value, "middleName"),
      .familyName = optionalText(value, "familyName"),
      .nameSuffix = optionalText(value, "nameSuffix"),
      .nickname = optionalText(value, "nickname"),
  };
}

dynamic nameValue(const std::optional<Provider::Name> &name) {
  Provider::Name parts = name.value_or(Provider::Name{});
  return dynamic::object("namePrefix", orNull(parts.namePrefix))("givenName", orNull(parts.givenName))(
      "middleName", orNull(parts.middleName))("familyName", orNull(parts.familyName))("nameSuffix", orNull(parts.nameSuffix))(
      "nickname", orNull(parts.nickname));
}

dynamic credentialValue(const Provider::Credential &credential) {
  return dynamic::object("user", orNull(credential.user))("email", orNull(credential.email))("fullName", nameValue(credential.fullName))(
      "realUserStatus", credential.realUserStatus)("state", orNull(credential.state))(
      "authorizationCode", orNull(credential.authorizationCode))("identityToken", orNull(credential.identityToken));
}

// The request the options describe, or why there is none.
std::optional<Provider::Request> requestOf(const dynamic &options, std::string &error) {
  Provider::Request request;
  if (options.isObject()) {
    if (const auto *scopes = options.get_ptr("requestedScopes"); scopes && scopes->isArray()) {
      for (const auto &scope : *scopes) {
        auto number = scope.isNumber() ? static_cast<int64_t>(scope.asDouble()) : -1;
        if (number != 0 && number != 1) {
          error = "ERR_INVALID_SCOPE: Invalid Apple authentication scope: " + std::to_string(number);
          return std::nullopt;
        }
        request.scopes.push_back(static_cast<Provider::Scope>(number));
      }
    }
    if (const auto *operation = options.get_ptr("requestedOperation"); operation && operation->isNumber()) {
      auto number = static_cast<int64_t>(operation->asDouble());
      if (number < 0 || number > 3) {
        error = "ERR_INVALID_OPERATION: Invalid type of Apple authentication operation: " + std::to_string(number);
        return std::nullopt;
      }
      request.operation = static_cast<Provider::Operation>(number);
    }
  }
  request.user = optionalText(options, "user");
  request.state = optionalText(options, "state");
  request.nonce = optionalText(options, "nonce");
  return request;
}

} // namespace

std::string appleAuthenticationFailure(Provider::Failure failure) {
  switch (failure) {
    case Provider::Failure::Canceled:
      return "ERR_REQUEST_CANCELED: The user canceled the authorization attempt";
    case Provider::Failure::InvalidResponse:
      return "ERR_INVALID_RESPONSE: The authorization request received an invalid response";
    case Provider::Failure::NotHandled:
      return "ERR_REQUEST_NOT_HANDLED: The authorization request wasn't handled";
    case Provider::Failure::Failed:
      return "ERR_REQUEST_FAILED: The authorization attempt failed";
    case Provider::Failure::NotInteractive:
      return "ERR_REQUEST_NOT_INTERACTIVE: The authorization request isn't interactive";
    case Provider::Failure::MatchedExcludedCredential:
      return "ERR_REQUEST_MATCHED_EXCLUDED_CREDENTIAL: This request matched an excluded credential";
    case Provider::Failure::NoWindow:
      return "ERR_WINDOW_UNAVAILABLE: Couldn't present the Sign in with Apple sheet because no active window is available";
    case Provider::Failure::Unknown:
    default:
      return "ERR_REQUEST_UNKNOWN: The authorization attempt failed for an unknown reason";
  }
}

std::shared_ptr<NativeModule> makeAppleAuthenticationModule(std::shared_ptr<AppleIdProvider> provider, bool noPrompts) {
  struct AppleAuthentication : NativeModule {
    std::function<void()> stop;

    AppleAuthentication(std::shared_ptr<AppleIdProvider> provider, bool noPrompts) : NativeModule("NgNativeAppleAuthentication") {
      listeners();
      promise("isAvailableAsync", [provider](const dynamic &, JsPromise promise) { promise.resolve(provider->entitled()); });
      promise("requestAsync", [provider, noPrompts](const dynamic &args, JsPromise promise) {
        std::string error;
        auto request = requestOf(args.empty() ? dynamic(nullptr) : args[0], error);
        if (!request) {
          promise.reject(error);
          return;
        }
        if (!provider->entitled()) {
          promise.reject(
              "ERR_REQUEST_NOT_HANDLED: Sign in with Apple needs the com.apple.developer.applesignin entitlement, and this "
              "build of the app is not signed with it");
          return;
        }
        if (noPrompts) {
          promise.reject(appleAuthenticationFailure(Provider::Failure::NotInteractive));
          return;
        }
        provider->perform(*request, [promise](std::optional<Provider::Credential> credential, Provider::Failure failure) {
          if (credential) {
            promise.resolve(credentialValue(*credential));
          } else {
            promise.reject(appleAuthenticationFailure(failure));
          }
        });
      });
      promise("getCredentialStateAsync", [provider](const dynamic &args, JsPromise promise) {
        std::string user = !args.empty() && args[0].isString() ? args[0].asString() : "";
        provider->credentialState(user, [promise](Provider::CredentialState state) { promise.resolve(static_cast<int>(state)); });
      });
      sync("formatFullName", [provider](const dynamic &args) -> dynamic {
        auto style = args.size() > 1 && args[1].isString() ? args[1].asString() : "default";
        return provider->formatName(nameOf(args.empty() ? dynamic(nullptr) : args[0]), style);
      });
    }

    void emitRevoked() const {
      emit("ngNativeAppleAuthentication", dynamic::object("type", "revoked"));
    }

    ~AppleAuthentication() override {
      if (stop) {
        stop();
      }
    }
  };
  auto module = std::make_shared<AppleAuthentication>(provider, noPrompts);
  std::weak_ptr<AppleAuthentication> weak = module;
  module->stop = provider->watchRevocations([weak] {
    if (auto alive = weak.lock()) {
      alive->emitRevoked();
    }
  });
  return module;
}

} // namespace ngn
