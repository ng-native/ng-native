---
__default__: patch
---

An app that installs the `@ng-native/*` packages from npm gets their components' own styles, such as `<markdown>`'s default `md-*` classes and `<touchable-opacity>`'s press fade, with no `libraryStyles` entry. The transformer compiles every `@ng-native/*` package's component CSS into native sheets, as it does in a workspace; before, those components drew unstyled unless the package was listed.
