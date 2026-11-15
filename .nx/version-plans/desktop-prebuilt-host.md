---
__default__: patch
---

`ng-native-desktop run` and `package` download the prebuilt macOS desktop host for the app's React Native version, checked against the SHA-256 in `@ng-native/desktop`'s `prebuilt.json`, when the app links no native desktop code and its `react-native-screens` and `react-native-safe-area-context` are the versions the host was built with. Otherwise, or with `NGN_DESKTOP_FROM_SOURCE=1`, the host is built from source as before.
