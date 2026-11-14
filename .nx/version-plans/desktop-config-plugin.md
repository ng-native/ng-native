---
__default__: patch
---

`@ng-native/desktop` has a config plugin, `["@ng-native/desktop", { ... }]` in `app.json`, that checks the desktop options (`documentTypes`, `capabilities` and `deny`) whenever Expo reads the config, so `expo start`, `expo export` and `ng-native-desktop` stop on an option that is not valid and list every problem. The macOS build reads the bundle identifier, URL schemes, icon, version, build number, updates URL and usage strings from the Expo keys the iOS build reads.
