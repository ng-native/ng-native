---
__default__: patch
---

`@ng-native/platform` now sets a bound `font: var(--token)`, `[style.font]="'var(--tui-font-heading-1)'"`, from the token's whole font as the same declaration in a stylesheet is set: size, family, style, weight and line height. It was dropped with a warning, and Taiga UI's typography examples were drawn in one size.
