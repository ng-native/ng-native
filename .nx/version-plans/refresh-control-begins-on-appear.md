---
__default__: patch
---

On iOS, a `<refresh-control>` that is already refreshing when its page is pushed, or when its tab is shown for the first time, starts spinning once the screen has appeared, so it no longer leaves a gap under a large title.

Before, native began it as the page mounted, before UIKit had laid the page out under its bars. Under a large title that left a gap the spinner's height between the title and the content, which stayed after the spinner stopped and showed on pages shown after it. React Native's own `RefreshControl` does the same. Now a control under a `<native-stack-outlet>` or `<native-tabs-outlet>` commits `refreshing` from the screen's `appear` (a tab's `didAppear`), so the spinner shows as the push finishes rather than during it. On Android, and on a view no outlet shows, nothing changes.

`SCREEN_SHOWN` in `@ng-native/device` is the signal it reads: false for a screen until native says the screen has appeared, then true, and always true outside an outlet.

In a Node test rendered for iOS, a refresh control under an outlet now commits `refreshing: false` until the test emits the screen's `topAppear` (for a tab, `topDidAppear`) with `fabric.emit`, since the fake Fabric sends no appear events.
