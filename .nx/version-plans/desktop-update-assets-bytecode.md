---
__default__: patch
---

On macOS an Expo update whose bundle is Hermes bytecode finds its images: the desktop host answers each asset's `file:` URL by its file hash (`NgNativeUpdates.localAssets`), and `@ng-native/metro` makes React Native's `resolveAssetSource` look there first in a `macos` bundle.
