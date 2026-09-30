---
__default__: patch
---

`nx add @ng-native/nx` in a workspace with package-manager workspaces now pins `expo`, `react` and `react-native` at the root to the app's versions, and no longer adds `@expo/cli` there, so pnpm stops installing a second, newer React Native and React for `@nx/expo`'s `expo` peer.
