---
__default__: patch
---

On iOS, a swipe no longer dismisses a presented screen that a `canDeactivate` guard refuses to leave, and a refused swipe no longer strands the router on a page nobody can see; on Android, dragging a `formSheet` down still dismisses it whatever the guard says.

A screen shown with `present()`, on the stack or over another tab, now sets `preventNativeDismiss` when leaving it would run a `canDeactivate` guard, and a dismissal it refuses goes to the router, where the guard answers. A swipe the guard allows dismisses the screen after it has answered. Android's Back button and header back arrow go the same way. A page that also binds `preventNativeDismiss` hears `nativeDismissCancelled` for these attempts, even while its binding is false. Pushed screens are not held: on iOS, a swipe back from one is not stopped by its guard.

A `canDeactivate` guard of a route above a page presented from another tab is given no component. When it fails, the failure now goes to the app's `ErrorHandler` and the page is dismissed, where the navigation failed and the page stayed up.
