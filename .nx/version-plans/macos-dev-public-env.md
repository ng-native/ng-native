---
__default__: patch
---

A `macos` dev bundle reads `process.env.EXPO_PUBLIC_*`. The `@ng-native/metro` preset resolved `expo/virtual/env`, which babel-preset-expo imports for those variables in dev, to an empty module, so a dev bundle threw at the first one it read. A release bundle, where the values are inlined, was not affected.
