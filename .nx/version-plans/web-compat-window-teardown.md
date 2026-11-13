---
__default__: patch
---

With `@ng-native/web-compat`, a root service that listens on the window no longer throws as the last app that asked for the package is destroyed. The package's own teardown runs before the destroy hooks of the services the app made after it, and it took the window's `addEventListener`, `removeEventListener` and `dispatchEvent` away, so a service that listened with `fromEvent(window, 'resize')` and `toSignal` or `takeUntilDestroyed`, as Taiga UI's root does, failed to take its listener off, and rxjs threw an `UnsubscriptionError` from `ApplicationRef.destroy()` and `@ng-native/testing`'s `cleanup()`.

Those three now stay on the window once the last app has gone, where `withWebCompat` gave the window no stand-ins of its own (in a test, or a Metro config without it); where it did, the stand-ins are put back as before. Every listener added to the window while an app was up still goes with the last app, so taking one off afterwards finds nothing left to remove, and a listener added after the last app has gone is kept for the next app, as the stand-ins keep one. The rest of what the package adds is still taken away.
