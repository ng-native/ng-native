#include "web-browser.h"

#import <AppKit/AppKit.h>
#import <AuthenticationServices/AuthenticationServices.h>

#include <mutex>

// The window a sign-in sheet hangs from: the key window, else the main one, else any.
@interface NGNAuthPresenter : NSObject <ASWebAuthenticationPresentationContextProviding>
@end

@implementation NGNAuthPresenter
- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
  if (NSApp.keyWindow != nil) {
    return NSApp.keyWindow;
  }
  if (NSApp.mainWindow != nil) {
    return NSApp.mainWindow;
  }
  return NSApp.windows.firstObject != nil ? NSApp.windows.firstObject : [[NSWindow alloc] init];
}
@end

namespace ngn::appkit {

namespace {

class WebAuthSession final : public AuthSession {
 public:
  void start(const Request &request, std::function<void(std::optional<std::string>, std::string)> done) override {
    NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:request.url.c_str()]];
    NSString *scheme = request.callbackScheme.empty() ? nil : [NSString stringWithUTF8String:request.callbackScheme.c_str()];
    bool ephemeral = request.ephemeral;
    auto answer = std::make_shared<std::function<void(std::optional<std::string>, std::string)>>(std::move(done));
    dispatch_async(dispatch_get_main_queue(), ^{
      if (url == nil) {
        (*answer)(std::nullopt, "the url does not parse");
        return;
      }
      ASWebAuthenticationSession *session = [[ASWebAuthenticationSession alloc]
                initWithURL:url
          callbackURLScheme:scheme
          completionHandler:^(NSURL *callback, NSError *error) {
            {
              std::lock_guard lock(mutex_);
              session_ = nil;
            }
            if (callback != nil) {
              (*answer)(std::string(callback.absoluteString.UTF8String), "");
            } else if (error == nil || ([error.domain isEqualToString:ASWebAuthenticationSessionErrorDomain] &&
                                        error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin)) {
              (*answer)(std::nullopt, "");
            } else {
              (*answer)(std::nullopt, error.localizedDescription.UTF8String);
            }
          }];
      session.presentationContextProvider = presenter_;
      session.prefersEphemeralWebBrowserSession = ephemeral;
      {
        std::lock_guard lock(mutex_);
        session_ = session;
      }
      if (![session start]) {
        {
          std::lock_guard lock(mutex_);
          session_ = nil;
        }
        (*answer)(std::nullopt, "the session did not start");
      }
    });
  }

  void cancel() override {
    dispatch_async(dispatch_get_main_queue(), ^{
      ASWebAuthenticationSession *session;
      {
        std::lock_guard lock(mutex_);
        session = session_;
      }
      // Its completion handler answers, as a cancelled login.
      [session cancel];
    });
  }

 private:
  std::mutex mutex_;
  ASWebAuthenticationSession *session_{nil};
  NGNAuthPresenter *presenter_ = [[NGNAuthPresenter alloc] init];
};

} // namespace

std::shared_ptr<AuthSession> makeAuthSession() {
  return std::make_shared<WebAuthSession>();
}

} // namespace ngn::appkit
