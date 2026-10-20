---
__default__: patch
---

With `@ng-native/web-compat`, a `touchmove` listener that is not passive and calls `preventDefault()` stops the page scrolling under the finger until the touch ends or is canceled, as a slider or a carousel asks a browser to.

A passive listener on the window, the document or the body that calls `preventDefault()` does not prevent the event's default, as in a browser.

A drag kept from the page, by a `touchmove` listener or by `touch-action`, holds every scroll view it is in, so a slider in a carousel in a scrolling page moves neither.
