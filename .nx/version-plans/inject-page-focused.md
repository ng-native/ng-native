---
__default__: patch
---

`@ng-native/router` has `injectPageFocused()`, a signal that is true while a page's tab is selected and nothing is stacked over it, for stopping work such as a poll or a socket while the page stays mounted behind another.

It reads the same state as `SCREEN_IN_FRONT` from `@ng-native/device`. It does not follow the app going to the background, which `AppState` does.
