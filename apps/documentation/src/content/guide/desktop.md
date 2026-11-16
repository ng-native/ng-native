---
title: Build for the Mac
summary: The same Angular app as a native macOS app, with AppKit views, windows and a menu bar.
---

# Build for the Mac

An Angular Native app runs on macOS as a native app: AppKit views drawn by the
[desktop host](/packages/desktop), React Native's C++ core and Hermes, with no web view.

EAS Build and EAS Update do not build or update macOS apps. You build a Mac app on a Mac, with
`npm run package`, and ship new versions of it through Sparkle, which only a `dmg` packaged with
`--feed-url` and a public key carries (see [Packaging](/packages/desktop/packaging#the-build)); the
`app` that `npm run package` makes has no updater. To build, sign and notarise it on every push,
see [Package in GitHub Actions](/guide/desktop-github-actions).

## Start

A new app that is only for the Mac starts from the desktop template, whose README is its quick
start:

```sh
npx create-expo-app@latest my-app --template @ng-native/template-desktop
cd my-app
npm start          # the dev server, in one terminal
npm run macos      # gets the desktop host the first time, then opens the app
```

Expo is the build tool here, not the runtime: its CLI, config, autolinking and Metro build the
app, and the desktop host runs it. To add macOS to an app you have, see
[Desktop setup](/packages/desktop#setup), which also covers Nx and the Angular CLI.

## What a Mac app has

- **Windows.** The root component renders in the main window, and `AppWindows` opens more: a
  component in each, or a named outlet of the app's one Router. See
  [Windows](/packages/device/app-windows).
- **Menus.** Every app gets the standard menu bar. `<menu-bar>`, `<menu-group>` and `<menu-item>`
  add to it, `[contextMenu]` gives a view a menu on a secondary click, and `[shortcut]` a key.
  See [Menus](/packages/components/menus).
- **A sidebar.** `<split-view>`, `<sidebar>`, `<sidebar-section>` and `<sidebar-item>` are the
  window's source list, and a tab app's tabs become one. See
  [Sidebar](/packages/components/sidebar).
- **The mouse and keyboard.** `:hover`, `:focus-visible`, `cursor`, `(mouseenter)`,
  `(dblclick)`, `(contextmenu)` and Tab order all work, and `<native-button>` is an AppKit button.
- **Drag and drop.** `(fileDrop)` takes files, text and urls dragged onto a view, and `[dragItem]`
  lets a view be dragged out. See [Drag and drop](/packages/components/drag-and-drop).
- **The system.** The [Dock and a menu bar icon](/packages/device/dock), declared programs, urls
  and files through [Processes and Shell](/packages/device/processes), and the app's own actions on
  Edit > Undo through [UndoStack](/packages/device/undo-stack).

The pages under this one cover [what differs](/guide/desktop-differences) from iOS and Android,
[how big things are](/guide/desktop-sizing) on a Mac, [where each desktop API is imported
from](/guide/desktop-imports), [what each OS has](/guide/desktop-support), and how
[Electron's APIs](/guide/desktop-electron) map to these.

## Test it

`render(X, { os: 'macos' })` renders a component as on macOS, in its main window, with recording
fakes of the windows, menus, Dock and tray. See
[Testing on another OS](/packages/testing/testing-other-os).

An app from the desktop template, or from the generators' desktop-only option, has two Vitest
projects. `node-macos` runs in Node, and is what `npm test` (`vitest run --project node-macos`)
and the app's `test` target run. `macos` runs `src/**/*.device.ts`, such as
`src/app/app.device.ts`, inside the app on real AppKit views, and opens the app itself:

```sh
EXPO_PUBLIC_DEVICE_TESTS=1 npx expo start   # in one terminal
npx vitest --project macos
```
