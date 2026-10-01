---
__default__: minor
---

`Storage`, `SecureStorage`, `audioPlayer` and `videoPlayer` each have an entry point of their own, `@ng-native/expo/async-storage`, `/secure-store`, `/audio` and `/video`, so an app bundles with only the native module it uses installed, where Metro failed with "Unable to resolve module" for the other one.

This is a breaking change: `@ng-native/expo/store` and `@ng-native/expo/player` no longer export those four names. `Store`, `NativeStore`, `Player`, `PlayerState` and `watchPlayer` stay where they were, and `/player` now also exports `watchAudioPlayer` and `ownPlayer`, which the two players are built from. The `split-store-and-player` migration moves the imports for you: `nx migrate @ng-native/nx@latest`, `ng update @ng-native/schematics` or `npx @ng-native/migrate@latest`, as [Updating an app](https://ng-native.com/guide/updating) describes. It leaves a namespace import, `export *`, `require()`, `import()` or a test's `vi.mock` of the old entry point as it was, and prints a note with the file and line to change.
