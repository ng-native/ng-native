---
__default__: patch
---

On macOS the desktop host draws `react-native-webview`'s web view (`<web-view>`) with WKWebView when the app has the library installed: its source, injected scripts, messages both ways, navigation events and commands, as on iOS, and `originWhitelist`.
