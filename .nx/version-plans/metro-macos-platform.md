---
__default__: patch
---

`withAngularNative()` bundles `macos` (`npx expo export -p macos`, Expo SDK 58) with React Native's iOS paths: React Native's own `Platform.OS === 'ios'` checks match `macos` too, in dev and release, so `Alert.alert` keeps its body, and `Platform.select` answers from `macos`, then `ios`, then `native`, then `default`. App code sees `Platform.OS` as `'macos'`. On macOS, `expo/*` and every `expo-*` package resolve to an empty module, and `import 'expo'` installs `URL`, `URLSearchParams`, `TextDecoderStream`, `DOMException` and `structuredClone`. The preset throws when `expo.platforms` lists `macos`, or the command asks for it, without `experiments.outOfTreePlatforms: true`, which Expo needs to bundle `macos` at all.
