---
__default__: patch
---

On macOS `AppleSignIn` signs in through the desktop host's `NgNativeAppleAuthentication`, over AuthenticationServices, in an app signed with the Sign in with Apple entitlement. Without the entitlement `available()` is false and `signIn()` rejects with `ERR_REQUEST_NOT_HANDLED`, showing no sheet.
