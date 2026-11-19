---
title: What differs on the desktop
summary: Where a macOS or Linux app behaves differently from the same app on iOS, and what library code sees.
---

# What differs on the desktop

## The OS

`OS` from `@ng-native/device` and React Native's `Platform.OS` answer `'macos'`. `DESKTOP` is true
on macOS, and `APPLE` on iOS and macOS, so a check for an Apple OS does not have to be written as
`OS === 'ios'`. The `macos:` and `desktop:` Tailwind variants and the `platform-macos` class match
on a Mac.

Linux is an OS too: `OS` answers `'linux'` there, `DESKTOP` is true and `APPLE` false, and the
`linux:` and `desktop:` variants match. A Linux build takes `.linux`, then `.ios`, then `.native`
files, React Native's iOS code, and `Platform.select` from `linux`, then `ios`, as a Mac build does
for `macos`; a `macos` key does not answer on Linux. React Native's types have no `'linux'`, so
check `OS` from `@ng-native/device` rather than `Platform.OS`. [On Linux](#on-linux) below says
what else differs.

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

## On Linux

The same app on Linux differs from a Mac's in these ways. [Build for Linux](/guide/desktop-linux)
has the setup and the packages.

- Closing the last window quits the app, and `provideAppLifecycle({ quitWhenLastWindowCloses:
false })` keeps it running instead. There is no Dock to click: launching the app again, from the
  launcher or with a link or a file, goes to the instance running and opens its main window.
- A window's size is saved and comes back, maximised or full screen when it was, but never its
  place: the desktop places each window. After a reload or a relaunch the main window, route
  windows and `restoreKey` windows open again.
- The menu bar is a bar under the header bar on KDE Plasma and the header bar's main menu on every
  other desktop. `mod` in a shortcut is Ctrl. Back and forward are Alt+Left and Alt+Right, the
  keyboard's Back and Forward keys, and mouse buttons 8 and 9.
- The title bar is libadwaita's header bar, with the window controls in every `titleBar` mode.
- A `<tray-icon>` is a StatusNotifierItem, shown only where a StatusNotifierWatcher runs (KDE
  Plasma, and GNOME with the AppIndicator extension): `Tray.available()` is `false` elsewhere.
  `Dock.available()` is always `false`, and the badge is the launcher's count, which KDE Plasma and
  Ubuntu's dock show and stock GNOME does not.
- Text follows the desktop's text scaling, as `fontScale`, and layout sizes do not. See
  [Sizing for GNOME](/guide/desktop-sizing#sizing-for-gnome).
- Files, links, notifications and printing go through the desktop's
  [portals](/packages/desktop/portals), and SecureStore needs a Secret Service (GNOME Keyring or
  KWallet) running.
- Orca reads the app and its focus, and has no structural navigation by heading or landmark. See
  [Focus and accessibility](/packages/desktop/accessibility#on-linux).
- Updates reach the app as a new package, from the package manager or Flatpak. The Linux host does
  not check an updates server yet.
