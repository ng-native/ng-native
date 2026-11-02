---
__default__: patch
---

`@ng-native/expo` has a config plugin with a `pointerEvents` option, off by default, that turns on React Native's W3C pointer events on iOS and Android, so a trackpad, a mouse or a pencil reaches `Pressable.hovered` and `@defer (on hover)`.

Add `["@ng-native/expo", { "pointerEvents": true }]` to the plugins in `app.json`, then run `npx expo prebuild` and make a new development build. It also sets `UIApplicationSupportsIndirectInputEvents` in Info.plist, which iOS 16 needs to tell a trackpad or a mouse from a finger. It has no effect in Expo Go. A finger's pointer events do not set `hovered` or fire `@defer (on hover)`. The development warning for `@defer (on hover)` now names the option.
