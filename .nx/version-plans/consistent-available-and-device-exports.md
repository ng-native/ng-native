---
__default__: minor
---

Two small breaking changes, each with an automated migration, that `nx migrate`, `ng update` and `npx @ng-native/migrate` run, and one consistency fix:

- `Tracking`'s `available` is a property, as `Haptics`, `Fonts` and `SplashScreen` have it: read `tracking.available` rather than calling it. The `tracking-available-getter` migration rewrites the calls, in code and in templates. A service's `available` now follows one rule, set out on the Using a module page: a property when the answer is known at once, a method that resolves when it is a fresh native check, and a signal when it comes and goes.
- `@ng-native/device` no longer exports `reactNative()` or its `ReactNative` type, which are how the package reaches React Native; import from `react-native` directly. The `device-react-native-import` migration notes each import it finds.
- A `<switch>`'s own position wins over an `aria-checked` or `accessibilityState.checked` that says otherwise in the `accessibilityState` it sends, as its own `disabled` already wins over `aria-disabled`. VoiceOver and TalkBack read the native switch's position either way, so what they announce does not change.
