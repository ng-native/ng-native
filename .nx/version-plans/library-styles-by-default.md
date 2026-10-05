---
__default__: minor
---

Every component library's own CSS is compiled into native sheets with nothing to configure, in the Metro preset and in the Vitest plugin; before, a library drew unstyled unless its package was listed in `libraryStyles`. A list in `libraryStyles` still names the only packages compiled, so a config that has one builds as it did. An app with no list now gets each library's styles, and one build warning for each library file that drops something native cannot express; set `libraryStyles: false` to compile none but the `@ng-native/*` packages', as before.
