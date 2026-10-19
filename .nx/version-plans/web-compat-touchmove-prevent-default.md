---
__default__: patch
---

With `@ng-native/web-compat`, a `touchmove` or `pointermove` listener that is not passive and calls `preventDefault()` stops the page scrolling under the finger until it lifts, as a slider or a carousel asks a browser to.
