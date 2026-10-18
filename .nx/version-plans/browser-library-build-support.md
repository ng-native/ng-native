---
__default__: patch
---

The Metro transformer can be told which libraries, and which of the app's own directories, are written for a browser: their flex containers are laid out as rows, a rule in such a directory that does not parse is dropped rather than failing the build, and the app is told which elements their selectors name. Nothing sets this yet; it is for the upcoming `@ng-native/web-compat` package, and apps see no change.
