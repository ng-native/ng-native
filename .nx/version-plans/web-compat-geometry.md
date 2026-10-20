---
__default__: patch
---

`@ng-native/web-compat` gives a library geometry and the observers.

`getBoundingClientRect` and `getClientRects` answer `DOMRect`s, and `offsetParent` and the `offset`, `client` and `scroll` sizes and positions are read from where native last laid an element out, with what is pending committed first. An element whose style says `overflow: auto` or `scroll` scrolls what overflows it, with `scrollTop` and `scrollLeft`, `scroll`, `scrollTo`, `scrollBy` and `scrollIntoView`. `window.screen`, `visualViewport`, `matchMedia`, `ResizeObserver` and `IntersectionObserver` are there, and an app that observes nothing pays nothing for them. A `<style>` read while the app runs takes `@media` by the window's height, which way up it is and the colour scheme and motion the user asked for, as well as its width, and `getComputedStyle` answers a `width` or `height` an element has none of its own of as it is drawn.
