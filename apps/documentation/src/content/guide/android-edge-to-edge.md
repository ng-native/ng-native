---
title: Android edge-to-edge
summary: What changes on Android now that every app draws under the status bar and navigation bar.
---

# Android edge-to-edge

An Android app built with Expo SDK 57 targets Android SDK 35 or later (36 by default), so it always
draws edge-to-edge: the app's window runs under the status bar at the top and the navigation bar at
the bottom, as an iOS app runs under the notch and the home indicator. React Native turns it on for
any app that targets SDK 35 or later, and Expo's `app.json` has no option to turn it off. The one
way out is a theme that sets `android:windowOptOutEdgeToEdgeEnforcement`, which Android 16 ignores
and earlier versions honor; this page assumes no such theme.

## Options that do nothing

These options date from before edge-to-edge. They still compile, and are marked deprecated:

- `StatusBar`'s `backgroundColor` and `translucent`, from `@ng-native/device`. React Native's
  Android module ignores both. In development the first use of each logs a warning on Android
  under edge-to-edge, and on iOS neither is sent at all. See
  [Status bar](/packages/device/status-bar).
- `statusBarColor`, `statusBarTranslucent`, `navigationBarColor` and `navigationBarTranslucent` in
  a screen's presentation. `react-native-screens` ignores them on Android, and iOS has none of
  them.

`<modal>`'s `statusBarTranslucent` and `navigationBarTranslucent` are not deprecated, but on Android
both are always on whatever you set. See [Modal](/packages/components/modal).

To color the area behind the status bar, color the view that is under it.

## Which screens need a safe area

A native header owns the top inset: a page under a shown header starts below it, and needs no
`<safe-area-view>` for the top edge. See [Insets](/packages/router/header#insets).

Everything else starts at the top of the window, under the status bar:

- A tab screen with no header, or a stack page whose header is hidden. Wrap its content in
  `<safe-area-view [edges]="['top']">`, or `<screen-safe-area-view [edges]="['top']">`, which also
  follows a header that comes and goes.
- A modal and a presented screen. Each is outside the app's view tree, so it needs its own
  `<safe-area-provider [reportInsets]="false">` with a `<safe-area-view>` inside it. See
  [Presented screens have no header](/packages/router/screens#presented-screens-have-no-header) and
  [Safe area in a modal](/packages/components/modal#safe-area-in-a-modal).

Content pinned to the bottom of the screen sits under the navigation bar the same way, and clears
it with the `bottom` edge, or with `<tab-safe-area-view>` above a tab bar.

## Insets are real numbers

The insets come from native views, measured inside the window, so on Android the top inset is the
status bar's height and the bottom inset is the navigation bar's. The
[`SafeArea`](/packages/device/safe-area) service, the `--safe-area-inset-*` custom properties and
`env(safe-area-inset-*)` in a stylesheet all read the same numbers once the root
`<safe-area-provider>` has laid out, one frame after the app mounts. See
[Safe area](/packages/components/safe-area).

## The keyboard

Android sends no `keyboardWill*` events, so [`Keyboard`](/packages/device/keyboard) listens to
`keyboardDidShow` and `keyboardDidHide` there. `<keyboard-avoiding-view>` and the other views that
follow the keyboard move once it has settled, not alongside it as they do on iOS.

That includes `<keyboard-dock>`, with or without react-native-keyboard-controller: only on iOS,
with that library, does the bar move with the keyboard frame by frame. See [A bar that rides the
keyboard](/packages/components/keyboard-avoiding-view#a-bar-that-rides-the-keyboard).
