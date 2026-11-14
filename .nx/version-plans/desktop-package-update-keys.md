---
__default__: patch
---

`ng-native-desktop package` in `@ng-native/desktop` writes the updates server's code signing certificate (`updates.codeSigningCertificate` and `codeSigningMetadata`) into the app's `Info.plist`, and a `dmg` with `--feed-url` now needs Sparkle's public EdDSA key, from the new `--sparkle-key` or `NGN_SPARKLE_PUBLIC_KEY`. Sparkle checks for updates on its own schedule by default.
