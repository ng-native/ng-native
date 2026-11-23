---
__default__: patch
---

The device test pool now launches an app again when it has not connected within 90 seconds, at most three launches in all, and the iOS and Android launchers wait until Metro answers its status within a second before they launch the app.

An app that does not connect is stopped before the next one is launched, and with a `connectTimeout` below 270 seconds each of the first two launches waits a third of it. The pool still fails with the same message once `connectTimeout` has passed with no app connected. React Native's development build asks Metro for its status before its bundle and stops asking after three answers that take too long, which a Metro still busy on a loaded CI runner can give, so an app launched then never loaded.
