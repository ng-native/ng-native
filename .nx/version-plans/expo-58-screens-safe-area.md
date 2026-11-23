---
__default__: patch
---

New apps and the examples take `react-native-safe-area-context` 5.11.1, and the prebuilt desktop host is built with it and with `react-native-screens` 4.30.1, the versions `npx expo install` picks for Expo SDK 58.

An app that adds the router by `npx expo install react-native-screens`, as its setup guide says, then has the prebuilt desktop host's version of it, so that library no longer makes the host build from source. The Expo, Nx, Angular CLI and migration generators write `react-native-safe-area-context` `~5.11.1`, and the desktop-only app exactly 5.11.1, the prebuilt host's version.
