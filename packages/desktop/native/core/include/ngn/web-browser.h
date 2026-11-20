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

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
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

// An AuthSession for a host with no sign-in sheet of its own (GTK's): the page opens in the user's
// browser, and the session ends on the first link back to the app on its callback scheme, which
// the OS hands the running app as it would any link (a second launch, or D-Bus activation). That
// link ends the session and nothing else hears it, as ASWebAuthenticationSession keeps its own.
// While the session runs the host shows a prompt over the app saying the sign-in goes on in the
// browser, whose Cancel ends it as cancelled: without one, a browser closed before the redirect
// would leave the session waiting for ever. `ephemeral` is not the host's to give, since the
// browser keeps its own cookies.
class LinkAuthSession final : public AuthSession, public std::enable_shared_from_this<LinkAuthSession> {
 public:
  struct Hooks {
    // Opens the page in the user's browser; `opened` hears whether it did. Any thread.
    std::function<void(const std::string &url, std::function<void(bool opened)> opened)> openUrl;
    // Shows the prompt, whose Cancel calls `cancelled`, and answers how to take it away. Any
    // thread; empty for no prompt.
    std::function<std::function<void()>(std::function<void()> cancelled)> prompt;
  };
  explicit LinkAuthSession(Hooks hooks);
  void start(const Request &request, std::function<void(std::optional<std::string> url, std::string error)> done) override;
  void cancel() override;
  // A link the app was opened with: true when it is on the scheme of the session in progress,
  // which it ends, and which the app's Linking then never hears. Any thread.
  bool receive(const std::string &url);

 private:
  struct Ending {
    std::function<void(std::optional<std::string>, std::string)> done;
    std::function<void()> hide;
  };
  // Takes the session's completion and prompt; call with mutex_ held.
  Ending take();
  static void end(Ending ending, std::optional<std::string> url, std::string error);
  // Ends the session in progress, or only when it is still `attempt` (a callback of an earlier
  // session ends nothing).
  void finish(std::optional<uint64_t> attempt, std::optional<std::string> url, std::string error);

  Hooks hooks_;
  std::mutex mutex_;
  std::string scheme_;
  uint64_t attempt_{0};
  std::function<void(std::optional<std::string>, std::string)> done_;
  std::function<void()> hidePrompt_;
};

std::shared_ptr<NativeModule> makeWebBrowserModule(std::shared_ptr<System> system, std::shared_ptr<AuthSession> sessions, bool noPrompts);

} // namespace ngn
