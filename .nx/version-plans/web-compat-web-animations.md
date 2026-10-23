---
__default__: patch
---

An element's `getAnimations()` answers as the Web Animations API does under `@ng-native/web-compat`, with a `finished` that settles when an animation ends or stops, and `updateTiming({ fill: 'forwards' })` to hold one at its last frame.
