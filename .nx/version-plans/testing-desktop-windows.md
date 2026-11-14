---
__default__: patch
---

In `@ng-native/testing`, `render(X, { os: 'macos' })` renders the component in the main window `AppWindows` opens, with a recording fake of the host's windows and of its deep links, as `provideDesktopFakes()` now also provides. `screen.windows()` lists the open windows, each with queries bound to its own views, and `screen`'s queries search every window. A menus fake finds an item with `item({ menuRole, label })` and chooses one with `choose(...)`. `userEvent.rightClick` answers the context menu it opened, to choose from; `userEvent.dropFiles` drops files on a view; and `userEvent.closeWindow`, `quit`, `reopen` and `openUrl` play the window's close button, Cmd-Q, a Dock click and a link opening the app.
