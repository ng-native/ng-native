#import "apple-authentication.h"

#import <AppKit/AppKit.h>
#import <AuthenticationServices/AuthenticationServices.h>
#import <Security/Security.h>

#include <mutex>
#include <set>

using Provider = ngn::AppleIdProvider;

namespace {

NSString *string(const std::optional<std::string> &text) {
  return text ? [NSString stringWithUTF8String:text->c_str()] : nil;
}

std::optional<std::string> text(NSString *value) {
  return value != nil ? std::optional<std::string>(value.UTF8String) : std::nullopt;
}

std::optional<std::string> utf8(NSData *data) {
  if (data == nil) {
    return std::nullopt;
  }
  NSString *decoded = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  return text(decoded);
}

Provider::Failure failureOf(NSError *error) {
  if (![error.domain isEqualToString:ASAuthorizationErrorDomain]) {
    return Provider::Failure::Unknown;
  }
  switch (error.code) {
    case ASAuthorizationErrorCanceled:
      return Provider::Failure::Canceled;
    case ASAuthorizationErrorInvalidResponse:
      return Provider::Failure::InvalidResponse;
    case ASAuthorizationErrorNotHandled:
      return Provider::Failure::NotHandled;
    case ASAuthorizationErrorFailed:
      return Provider::Failure::Failed;
    case ASAuthorizationErrorNotInteractive:
      return Provider::Failure::NotInteractive;
    default:
      // ASAuthorizationErrorMatchedExcludedCredential (1006) from macOS 15.
      return error.code == 1006 ? Provider::Failure::MatchedExcludedCredential : Provider::Failure::Unknown;
  }
}

int realUserStatusOf(ASUserDetectionStatus status) {
  switch (status) {
    case ASUserDetectionStatusUnknown:
      return 1;
    case ASUserDetectionStatusLikelyReal:
      return 2;
    default:
      return 3;
  }
}

ASAuthorizationOpenIDOperation operationOf(Provider::Operation operation) {
  switch (operation) {
    case Provider::Operation::Login:
      return ASAuthorizationOperationLogin;
    case Provider::Operation::Refresh:
      return ASAuthorizationOperationRefresh;
    case Provider::Operation::Logout:
      return ASAuthorizationOperationLogout;
    case Provider::Operation::Implicit:
    default:
      return ASAuthorizationOperationImplicit;
  }
}

} // namespace

// One request in flight: the controller's delegate, kept alive until it answers.
@interface NGNAppleSignInRequest : NSObject <ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) ASAuthorizationController *controller;
@property (nonatomic) std::function<void(std::optional<Provider::Credential>, Provider::Failure)> done;
@end

namespace {
NSMutableSet<NGNAppleSignInRequest *> *pending() {
  static NSMutableSet *set = [NSMutableSet set];
  return set;
}
} // namespace

@implementation NGNAppleSignInRequest

- (void)finish:(std::optional<Provider::Credential>)credential failure:(Provider::Failure)failure {
  auto done = std::move(_done);
  _done = nullptr;
  [pending() removeObject:self];
  if (done) {
    done(std::move(credential), failure);
  }
}

- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithAuthorization:(ASAuthorization *)authorization {
  ASAuthorizationAppleIDCredential *apple = [authorization.credential isKindOfClass:ASAuthorizationAppleIDCredential.class]
      ? (ASAuthorizationAppleIDCredential *)authorization.credential
      : nil;
  Provider::Credential credential;
  credential.user = text(apple.user);
  credential.email = text(apple.email);
  if (NSPersonNameComponents *name = apple.fullName) {
    credential.fullName = Provider::Name{
        .namePrefix = text(name.namePrefix),
        .givenName = text(name.givenName),
        .middleName = text(name.middleName),
        .familyName = text(name.familyName),
        .nameSuffix = text(name.nameSuffix),
        .nickname = text(name.nickname),
    };
  }
  credential.realUserStatus = apple != nil ? realUserStatusOf(apple.realUserStatus) : 3;
  credential.state = text(apple.state);
  credential.authorizationCode = utf8(apple.authorizationCode);
  credential.identityToken = utf8(apple.identityToken);
  [self finish:credential failure:Provider::Failure::Unknown];
}

- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithError:(NSError *)error {
  [self finish:std::nullopt failure:failureOf(error)];
}

- (ASPresentationAnchor)presentationAnchorForAuthorizationController:(ASAuthorizationController *)controller {
  return _window;
}

@end

namespace ngn::appkit {

bool allowsAppleSignIn(id entitlement) {
  return [entitlement isKindOfClass:NSArray.class] && [(NSArray *)entitlement containsObject:@"Default"];
}

namespace {

class AppleIdProviderImpl final : public AppleIdProvider {
 public:
  bool entitled() override {
    SecTaskRef task = SecTaskCreateFromSelf(kCFAllocatorDefault);
    if (task == nullptr) {
      return false;
    }
    CFTypeRef value = SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.developer.applesignin"), nullptr);
    CFRelease(task);
    bool allowed = allowsAppleSignIn((__bridge id)value);
    if (value != nullptr) {
      CFRelease(value);
    }
    return allowed;
  }

  void perform(const Request &request, std::function<void(std::optional<Credential>, Failure)> done) override {
    dispatch_async(dispatch_get_main_queue(), ^{
      NSWindow *window = NSApp.keyWindow != nil ? NSApp.keyWindow : NSApp.mainWindow;
      if (window == nil) {
        done(std::nullopt, Failure::NoWindow);
        return;
      }
      ASAuthorizationAppleIDRequest *appleRequest = [[ASAuthorizationAppleIDProvider new] createRequest];
      NSMutableArray<ASAuthorizationScope> *scopes = [NSMutableArray array];
      for (auto scope : request.scopes) {
        [scopes addObject:scope == Scope::FullName ? ASAuthorizationScopeFullName : ASAuthorizationScopeEmail];
      }
      appleRequest.requestedScopes = scopes;
      appleRequest.requestedOperation = operationOf(request.operation);
      appleRequest.user = string(request.user);
      appleRequest.state = string(request.state);
      appleRequest.nonce = string(request.nonce);
      auto *pendingRequest = [NGNAppleSignInRequest new];
      pendingRequest.window = window;
      pendingRequest.done = done;
      pendingRequest.controller = [[ASAuthorizationController alloc] initWithAuthorizationRequests:@[ appleRequest ]];
      pendingRequest.controller.delegate = pendingRequest;
      pendingRequest.controller.presentationContextProvider = pendingRequest;
      [pending() addObject:pendingRequest];
      [pendingRequest.controller performRequests];
    });
  }

  void credentialState(const std::string &user, std::function<void(CredentialState)> done) override {
    [[ASAuthorizationAppleIDProvider new]
        getCredentialStateForUserID:[NSString stringWithUTF8String:user.c_str()]
                         completion:^(ASAuthorizationAppleIDProviderCredentialState state, NSError *) {
                           switch (state) {
                             case ASAuthorizationAppleIDProviderCredentialRevoked:
                               done(CredentialState::Revoked);
                               break;
                             case ASAuthorizationAppleIDProviderCredentialAuthorized:
                               done(CredentialState::Authorized);
                               break;
                             case ASAuthorizationAppleIDProviderCredentialTransferred:
                               done(CredentialState::Transferred);
                               break;
                             default:
                               done(CredentialState::NotFound);
                           }
                         }];
  }

  std::string formatName(const Name &name, const std::string &style) override {
    NSPersonNameComponents *components = [NSPersonNameComponents new];
    components.namePrefix = string(name.namePrefix);
    components.givenName = string(name.givenName);
    components.middleName = string(name.middleName);
    components.familyName = string(name.familyName);
    components.nameSuffix = string(name.nameSuffix);
    components.nickname = string(name.nickname);
    NSPersonNameComponentsFormatter *formatter = [NSPersonNameComponentsFormatter new];
    formatter.style = style == "short"         ? NSPersonNameComponentsFormatterStyleShort
                      : style == "medium"      ? NSPersonNameComponentsFormatterStyleMedium
                      : style == "long"        ? NSPersonNameComponentsFormatterStyleLong
                      : style == "abbreviated" ? NSPersonNameComponentsFormatterStyleAbbreviated
                                               : NSPersonNameComponentsFormatterStyleDefault;
    NSString *formatted = [formatter stringFromPersonNameComponents:components];
    return formatted != nil ? formatted.UTF8String : "";
  }

  std::function<void()> watchRevocations(std::function<void()> revoked) override {
    id observer = [NSNotificationCenter.defaultCenter addObserverForName:ASAuthorizationAppleIDProviderCredentialRevokedNotification
                                                                  object:nil
                                                                   queue:nil
                                                              usingBlock:^(NSNotification *) {
                                                                revoked();
                                                              }];
    auto stopped = std::make_shared<std::once_flag>();
    return [observer, stopped] {
      std::call_once(*stopped, [observer] { [NSNotificationCenter.defaultCenter removeObserver:observer]; });
    };
  }
};

} // namespace

std::shared_ptr<AppleIdProvider> makeAppleIdProvider() {
  return std::make_shared<AppleIdProviderImpl>();
}

} // namespace ngn::appkit
