---
__default__: patch
---

`ng-native-desktop run` downloads the prebuilt macOS desktop debug host for the app's React Native version, a dev build with React Native's debugger, and `package` the prebuilt release host, each checked against the SHA-256 in `@ng-native/desktop`'s `prebuilt.json`, when the app links no native desktop code and each host library it has installed (`react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `react-native-webview`, `react-native-worklets`, `react-native-reanimated`) is the version the host was built with and not in `deny`. Otherwise, or with `NGN_DESKTOP_FROM_SOURCE=1`, the host is built from source. Each release attaches both prebuilt hosts to its GitHub release.
