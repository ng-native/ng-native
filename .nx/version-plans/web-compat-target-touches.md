---
__default__: patch
---

A touch event from `@ng-native/web-compat` has `targetTouches`, the fingers down that came down on the element it is sent to, so a CDK drag and drop item no longer throws `Cannot read property 'pageX' of undefined` as a finger comes down on it.
