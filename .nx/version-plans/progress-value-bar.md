---
__default__: patch
---

`@ng-native/web-compat` now fills a `<progress>` to its value, as a library styles one with `::-webkit-progress-value` or `::-moz-progress-bar`: the bar is a box in the element, as wide a share of it as `value` is of `max`, and follows the value however it is set. With no value the element is `:indeterminate`. `value`, `max` and `position` are read and written as a browser's are.

A component in a directory given as `sources` now has its styles read as a library's are, `::before`, `::after`, masks and background images included, where they were refused.
