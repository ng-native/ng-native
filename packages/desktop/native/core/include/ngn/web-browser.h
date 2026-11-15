// NgNativeWebBrowser: what @ng-native/expo's Browser calls on expo-web-browser. A Mac has no
// in-app browser sheet, so a page opens in the user's default browser, and a sign-in runs in an
// AuthSession, which the AppKit backend implements with ASWebAuthenticationSession.
//
// - openBrowserAsync(url): opens an http or https url, by the one url policy Linking and Shell
//   use (externalUrlAllowed), and answers {type: 'opened'}. Anything else is refused.
// - dismissBrowser(): {type: 'dismiss'}; there is nothing of the host's to close.
// - openAuthSessionAsync(url, redirectUrl, {preferEphemeralSession}): {type: 'success', url} with
//   the url the session was redirected to, or {type: 'cancel'}. One at a time, as on iOS. The
//   session's callback scheme is redirectUrl's. With `noPrompts` (NGN_NO_PROMPTS=1) no session
//   starts, since the OS asks the user first, and the answer is {type: 'cancel'}.
// - dismissAuthSession(): ends the session in progress, which answers {type: 'cancel'}.
#pragma once

#include "ngn/native-module.h"
#include "ngn/system.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

class AuthSession {
 public:
  struct Request {
    std::string url;
    // The scheme the session ends on ("myapp"), or empty for none.
    std::string callbackScheme;
    bool ephemeral{false};
  };
  virtual ~AuthSession() = default;
  // Answers once, on any thread: the url the session ended on, or nothing when it was cancelled
  // (by the user, or by cancel()). `error` says why it could not start.
  virtual void start(const Request &request, std::function<void(std::optional<std::string> url, std::string error)> done) = 0;
  virtual void cancel() = 0;
};

// Whether `url` is http or https: what expo-web-browser opens.
bool webUrl(const std::string &url);

std::shared_ptr<NativeModule> makeWebBrowserModule(std::shared_ptr<System> system, std::shared_ptr<AuthSession> sessions, bool noPrompts);

} // namespace ngn
