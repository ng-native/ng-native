---
__default__: patch
---

On macOS `Browser` answers from the desktop host's `NgNativeWebBrowser`: `open()` opens an http or https url in the default browser, and `signIn()` runs an ASWebAuthenticationSession and answers the url it was redirected to, or null when it was cancelled.
