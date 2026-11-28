---
__default__: patch
---

`@ng-native/fabric` now works out a length bound as a style that is a `calc()`, `min()` or `max()` of tokens, `el.style.fontSize = 'calc(1.25rem + var(--tui-font-offset))'` as Taiga UI's fluid typography sets one, where the tokens are known, as the same sum in a stylesheet is. It was sent to native as text, which Android's text field crashed the app on. The same holds for one a script sets on an element's `style` in an app with `@ng-native/web-compat`.
