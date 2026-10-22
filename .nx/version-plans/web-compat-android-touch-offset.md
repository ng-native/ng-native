---
__default__: patch
---

With `@ng-native/web-compat` on Android, an element in a screen under a navigation header is measured where it is drawn and touched rather than the header's height above it, so `getBoundingClientRect()` and a touch's `clientY` agree and a library's own hit test finds the element under the finger.
