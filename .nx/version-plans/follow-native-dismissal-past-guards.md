---
__default__: patch
---

`@ng-native/router` lets a `canDeactivate` guard decide a native pop of a pushed screen, and follows a screen native has already dismissed without asking its guards, so a refusing guard no longer leaves the url on a screen that is gone.

The pushed screen in front holds `preventNativeDismiss` while leaving it would run a guard, as a presented screen already did, and lets go once it would not. On iOS a swipe back, the back button and a pick from its menu then go to the router, where the guard answers, as Android's Back button and header back arrow already did. On iOS a held push cannot be swiped back interactively: the swipe asks rather than following the finger, as with React Navigation's `usePreventRemove`.

A screen native dismisses anyway, such as a `formSheet` dragged down or closed by a tap outside it on Android, is followed without asking its guards or those of the routes showing inside it. A refusal used to keep the router on the dismissed screen, where its guard went on refusing the navigations that leave it, such as a tab switch or presenting another screen.

A stack inside a presented screen no longer passes on the hold of a guarded screen inside it as the page's own refusal, so a swipe down on the presented screen asks about leaving the whole screen.
