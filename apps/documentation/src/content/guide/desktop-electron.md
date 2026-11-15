---
title: Coming from Electron
summary: Electron's main-process APIs and where each one is in an Angular Native Mac app.
---

# Coming from Electron

An Electron app is a web page in a browser window, with a Node.js main process beside it. An
Angular Native Mac app is native macOS views, AppKit's own, run by one JavaScript runtime. There is
no main process and no renderer process, so there is no IPC: every window is part of the one
Angular app, and a root service is shared by all of them.

Windows and Linux are planned, with no date.

| Electron                                       | Angular Native                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `new BrowserWindow()`                          | `AppWindows.open(Component, options)` or `AppWindows.open({ outlet, path })`   |
| The first window                               | The root component, in the main window; `provideMainWindow` sizes it           |
| `ipcMain`, `ipcRenderer`, `contextBridge`      | None: inject a root service in each window                                     |
| `win.on('close')` with `preventDefault()`      | `window.canClose(guard)`, on the handle or on `CURRENT_WINDOW`                 |
| `app.on('window-all-closed')`                  | `provideAppLifecycle({ quitWhenLastWindowCloses })`, false on macOS by default |
| `app.on('before-quit')`                        | `AppLifecycle.willQuit(handler)`                                               |
| `app.quit()`                                   | `AppWindows.quit()`                                                            |
| `app.on('activate')`                           | Handled: a Dock click with no window open opens the main window                |
| `app.on('open-url')`                           | `DeepLinks`, for the app's url schemes                                         |
| `app.requestSingleInstanceLock()`              | Not needed: macOS runs one instance of an app                                  |
| `Menu.setApplicationMenu()`                    | `<menu-bar>` with `<menu-group>` and `<menu-item>`                             |
| `Menu.popup()` for a context menu              | `[contextMenu]` with a template of `<menu-item>`s                              |
| An accelerator on a menu item                  | `shortcut="mod+s"` on `<menu-item>`, or `[shortcut]` on any element            |
| `globalShortcut`                               | None: a shortcut works while the app is in front                               |
| `new Tray()`                                   | `<tray-icon>`                                                                  |
| `app.dock.setMenu()`, `app.dock.bounce()`      | `Dock.setMenu()`, `Dock.bounce()`                                              |
| `dialog.showOpenDialog()`                      | `DocumentPicker.pick()` or `DocumentPicker.pickDirectory()`                    |
| `dialog.showSaveDialog()`                      | `DocumentPicker.save()`                                                        |
| `dialog.showMessageBox()`                      | `Dialogs.tell()`, `Dialogs.confirm()` or `Dialogs.ask()`                       |
| `shell.openExternal()`                         | `Shell.openExternal()`                                                         |
| `shell.openPath()`, `shell.showItemInFolder()` | `Shell.openPath()`, `Shell.showItemInFolder()`                                 |
| `child_process.spawn()`                        | `Processes.spawn()`, for the programs the plugin options declare               |
| `process.env`                                  | `Processes.env`, the variables the plugin options declare                      |
| `clipboard`                                    | `Clipboard`                                                                    |
| `autoUpdater`                                  | Sparkle, embedded by `npm run package -- --format dmg --feed-url <appcast>`    |
| `electron-builder`, notarisation               | `npm run package -- --format dmg`, signed, notarised and stapled               |

## Node's APIs

There is no Node.js in the app. A program runs only when the `capabilities` in the plugin options
declare it, with the arguments they allow, and never through a shell. See
[Processes and Shell](/packages/device/processes).

## The web page

A template is native elements (`<view>`, `<text>`, `<scroll-view>`), styled with CSS that the
engine resolves into native props, not HTML in a browser. `:hover`, `:focus-visible`, `cursor`
and the mouse events work on a Mac. See [What differs on the Mac](/guide/desktop-differences).
