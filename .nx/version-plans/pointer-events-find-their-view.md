---
__default__: patch
---

On iOS, a pointer event on an engine node is no longer dropped by Fabric when an app has turned on React Native's W3C pointer events, so `Pressable.hovered` and `@defer (on hover)` follow the pointer in such an app.

React Native leaves those events off by default on iOS and Android, so nothing changes in an app that has not set `RCTSetDispatchW3CPointerEvents(YES)`. `fabric.emit` from `@ng-native/testing` now drops a `topPointer*` event on a view whose node has no committed view, as Fabric does.
