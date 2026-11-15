---
title: What differs on the Mac
summary: Where a macOS app behaves differently from the same app on iOS, and what library code sees.
---

# What differs on the Mac

## The OS

`OS` from `@ng-native/device` and React Native's `Platform.OS` answer `'macos'`. `DESKTOP` is true
on macOS, and `APPLE` on iOS and macOS, so a check for an Apple OS does not have to be written as
`OS === 'ios'`. The `macos:` and `desktop:` Tailwind variants and the `platform-macos` class match
on a Mac.

## Which files a Mac build takes

An import without an extension resolves `.macos` first, then `.ios`, then `.native`, then the
plain file. A library's iOS file is what a Mac build takes where it has no macOS one.

React Native's own JavaScript runs its iOS code on a Mac, since the desktop host answers its
iOS-named native modules. Inside React Native's `Libraries` and `src`, each `Platform.OS === 'ios'`
comparison is rewritten as the bundle is built to match `'macos'` as well. Code outside React
Native is left alone.

`Platform.select` answers from `macos`, then `ios`, then `native`, then `default`, in every file.

## For library authors

Your code sees `Platform.OS === 'macos'`, so a branch written for `'ios'` is not taken on a Mac:

```ts
// Taken on iOS only.
if (Platform.OS === 'ios') useAppleApi();

// Taken on iOS and macOS.
if (Platform.OS === 'ios' || Platform.OS === 'macos') useAppleApi();

// Or let select fall back: on a Mac it reads `macos`, then `ios`.
const inset = Platform.select({ ios: 20, android: 0 });
```

A `.ios.ts` file is used on a Mac unless a `.macos.ts` sits beside it. A library's native code
reaches the Mac build through its `expo-module.config.json`: see
[Native code](/packages/desktop#native-code). One with iOS or Android code and none for the
desktop is listed when the app builds, and its native module is absent on macOS.

## Expo's packages

None of Expo ships in a Mac app: `expo-*` packages resolve to an empty module. The services in
`@ng-native/expo` with a desktop source answer from the host's own modules (`DESKTOP_MODULES`
lists them). A service whose module the host has not got throws `MissingModuleError` on first use,
and a mobile-only one, such as sensors or the screen orientation, is absent: its `available()` is
false.

`import 'expo'` still installs a runtime: `URL`, `URLSearchParams`, `TextDecoderStream`,
`structuredClone`, and a `fetch` whose `Response` streams its `body`, over React Native's
Networking module. The host streams the body as bytes, so `body`, `bytes()` and `arrayBuffer()`
are byte-exact for any content, an image included. `blob()` is made from the body as text, so it
is exact only for a text body; read binary data through `arrayBuffer()`.

## Events

`(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)` and `(mouseout)` are React Native's
pointer events, and `(dblclick)`, `(contextmenu)` and `(wheel)` are the desktop host's. They keep
their DOM names, as on the web. `@ng-native/eslint-plugin`'s `desktop-only-events` rule warns that
each fires only on a desktop OS.

## Windows and the app

- Closing the last window leaves the app running in the Dock, and a click on the Dock icon opens
  the main window again. `provideAppLifecycle({ quitWhenLastWindowCloses: true })` quits instead.
- A window's frame is saved and comes back on the next launch. After a reload or a relaunch the
  main window, route windows and `restoreKey` windows open again.
- Back and forward (Cmd-[ and Cmd-], a swipe, mouse buttons 4 and 5) move through each window's
  history, as a browser does. Forward builds the page again from its URL, so a page's scroll
  position and form state are not kept.
- A tab app's tabs are the window's sidebar.
- `<modal>` is a sheet on the window, a cover inside it, or with an `anchor` a popover.

## Not on a Mac

`refresh-control`, `input-accessory-view` and `full-window-overlay` are a plain view. `controlSize`
sizes the native controls on macOS and `<native-button>` on iOS, and Android ignores it.
