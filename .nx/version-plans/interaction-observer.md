---
__default__: patch
---

`provideInteractionObserver()` in `@ng-native/components` reports the taps and long presses a control fires, and on iOS and Android the scrolls and swipes a user drags, as a plain `InteractionEvent`, for an analytics or monitoring tool that cannot see React Native's own `Pressable` and `ScrollView` in an Angular Native app.

A `click` or `long-press` comes from `<pressable>`, `<touchable-opacity>`, a pressable `<text>` and a component composing `PressBehavior`, including Android's click from a keyboard, the D-pad or TalkBack. A `scroll` or `swipe` comes from `<scroll-view>` and `<virtual-list>` on iOS and Android, and not for a scroll made by code; the web host reports taps and long presses only. `HostEngine` gains an optional `tagOf()`, which `Engine` already had.
