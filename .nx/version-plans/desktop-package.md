---
__default__: patch
---

`ng-native-desktop package` (`npm run package`) makes a universal release build of the app for macOS 14 and later: `--format app` (the default) an ad-hoc signed `.app`, `--format dmg` a Developer ID signed, notarised and stapled `.dmg`, with Sparkle and the `.zip` it updates from when `--feed-url` names an appcast, and `--format mas` a sandboxed Mac App Store `.pkg`, naming the capabilities the sandbox forbids. It stops before building without full Xcode, which compiles the icon, and reads signing and notarisation credentials from the environment.
