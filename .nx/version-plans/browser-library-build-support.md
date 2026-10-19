---
__default__: patch
---

The Metro transformer can be told which libraries, and which of the app's own directories, are written for a browser, which `withWebCompat()` from `@ng-native/web-compat/metro` does.

Their flex containers are laid out as rows, a rule in such a directory that does not parse is
dropped rather than failing the build, and the app is told which elements their selectors name.
Without it, apps see no change.
