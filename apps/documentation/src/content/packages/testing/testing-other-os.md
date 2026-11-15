---
title: Testing on another OS
summary: Run a test as macOS, iOS or Android, with that OS's files, a mouse, a keyboard and fakes.
---

# Testing on another OS

A test runs as one OS at a time: the files an extensionless import resolves, the view names, what
`OS` answers, and the media features a stylesheet sees all follow it.

## The project's OS

The Vitest preset takes an `os` per project. Unset, it follows `expo.platforms` in the app's
`app.json`: an app with `['macos']` alone tests as macOS, and any app that lists `ios` as iOS.

```ts
import { defineConfig } from 'vitest/config';
import { ngNative } from '@ng-native/testing/vitest';

export default defineConfig({
  test: {
    projects: [
      { plugins: [ngNative({ os: 'ios' })], test: { name: 'node-ios' } },
      { plugins: [ngNative({ os: 'macos' })], test: { name: 'node-macos' } },
    ],
  },
});
```

The Node projects take a `node-` prefix, because the projects that run inside the app are named
for their platform: `vitest --project macos` runs the in-app tests on a Mac.

An extensionless import resolves a platform file first, as Metro does: on macOS `./storage` is
`storage.macos.ts`, then `storage.ios.ts`, then `storage.native.ts`, then `storage.ts`. On Android
it is `.android`, then `.native`.

## One render as another OS

`render(X, { os, osVersion })` changes the OS for one render: the `OS`, `OS_VERSION`, `DESKTOP` and
`APPLE` tokens, the view names and the `platform-<os>` class, the `macos:` and `desktop:` variants,
and the `(hover)` and `(pointer)` media features, which a Mac answers `hover` and `fine`. One file
can check an OS gate both ways. It does not change which platform file an import resolved to:
that is the project's `os`.

```ts
it('offers the menu bar on macOS only', async () => {
  await render(Editor, { os: 'macos' });
  expect(screen.getByText('Open Recent')).toBeTruthy();
  cleanup();
  await render(Editor, { os: 'ios', osVersion: 26 });
  expect(screen.queryByText('Open Recent')).toBeNull();
});
```

## Mouse and keyboard

`userEvent` has the desktop's events too, and they work under any `os`:

- **`hover(node)`** and **`unhover(node)`** - a mouse onto and off a view, entering and leaving it
  and each view it is inside, so `:hover` and `(mouseenter)` follow.
- **`dblClick(node)`**, **`rightClick(node)`** and **`wheel(node, { deltaY })`** - `(dblclick)`,
  `(contextmenu)` and `(wheel)`. `rightClick` resolves to the context menu of the view, or of the
  nearest view it is inside with a `[contextMenu]`, with its `items` and `choose(label)`, or to
  null where there is none.
- **`dropFiles(node, ['/Users/me/notes.md'])`** - files dragged from Finder and dropped on a view
  with the `FileDrop` directive: `(fileDragEnter)`, then `(fileDrop)`, each with `files` holding
  each file's `file://` url and name.
- **`keyboard('mod+k')`** - a chord as `[shortcut]` writes one, with `mod` as Cmd on Apple's OSes
  and Ctrl elsewhere. The menus host matches it against the app's shortcuts and menu key
  equivalents, and a focused text input keeps the editing keys. Resolves to whether a shortcut
  took it.
- **`tab()`** and **`tab({ shift: true })`** - keyboard focus to the next or previous view that
  takes it, as focus from the keyboard, so `:focus-visible` matches.

## Windows

On macOS a render opens the main window, as an app does, and the component renders in it.
`screen.windows()` lists the open windows in the order they opened, each with its `surface`, `key`,
`title`, the app's `window` handle, and the queries bound to its own views; `screen`'s queries
search every window.

```ts
const { instance } = await render(Notes, { os: 'macos' });
await instance.openNote('Groceries');
const [main, note] = screen.windows();
expect(note.getByText('Groceries')).toBeTruthy();
expect(main.queryByText('Groceries')).toBeNull();
```

`userEvent` plays what the user does to the app as a whole:

- **`closeWindow(window?)`** - the close button or Cmd-W, on the window given or the focused one.
  Resolves to whether it closed, which a `canClose` guard can refuse.
- **`quit()`** - Cmd-Q: every window's guards, then the `willQuit` handlers. Resolves to whether
  the app agreed to quit.
- **`reopen()`** - a click on the Dock icon with no window open, which opens the main window.
- **`openUrl(url)`** - the app opened with a url, as a link to its scheme in another app does,
  which `DeepLinks` delivers.

## The desktop's services

On macOS a render's windows, menus, Dock, tray, processes and deep links are recording fakes: what
the app sends is there to read, and the test plays what the desktop host would send back. Provide
one to keep a handle on it, or `provideDesktopFakes()` to give them to a render on any OS.

```ts
import { Processes } from '@ng-native/device';
import { fakeProcesses, render } from '@ng-native/testing';

const processes = fakeProcesses({
  spawn: [{ program: 'git', args: ['status', '--porcelain'] }],
  programs: { '/usr/bin/git': { stdout: ' M main.ts\n' } },
});
await render(Changes, {
  os: 'macos',
  providers: [{ provide: Processes.SOURCE, useValue: processes }],
});
expect(processes.spawned[0]?.args).toEqual(['status', '--porcelain']);
```

`fakeMenus()` records the menu bar and shortcuts (`menuBarGroups`, `shortcuts`), the app's menus
merged with the defaults. `item({ menuRole: 'about' })` or `item({ label: 'New Note' })` finds an
item at any depth, and `choose(...)` clicks it, throwing where none matches or it is disabled.
`fakeDock()` records the Dock menu and bounces, `fakeTray()` the tray icons, with `press` and
`select`, `fakeWindows()` the windows `AppWindows` opened, and `fakeDeepLinks()` the urls the app
opened, with `emit(url)` to open the app with one.
