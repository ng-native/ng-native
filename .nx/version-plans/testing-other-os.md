---
__default__: patch
---

`@ng-native/testing` tests an app on another OS. The Vitest preset takes `os` (`'ios'`, `'android'`, `'macos'` or `'web'`), following `expo.platforms` in `app.json` when unset, and an extensionless import resolves the OS's platform file first (`.macos`, then `.ios`, then `.native` on a Mac). `render(X, { os, osVersion })` renders one component as another OS: its tokens, view names, platform class, variants, and a Mac's `hover` and `fine` pointer. `userEvent` gains `hover`, `unhover`, `dblClick`, `rightClick`, `wheel`, `keyboard('mod+k')` and `tab()`, and `fakeMenus`, `fakeDock`, `fakeTray`, `fakeWindows`, `fakeProcesses` and `provideDesktopFakes` record what an app sends the desktop host, which a render on macOS gets by default.
