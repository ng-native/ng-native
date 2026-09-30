---
__default__: patch
---

A `<modal>` shown a second time through `[visible]` takes touches, rather than ignoring every one.

The engine forgets the native views of a modal it leaves out of the tree while `visible` is false, so showing it again creates them afresh, as React Native's Modal.js does: Fabric never re-enables the events of a view that has been unmounted. The fake Fabric in `@ng-native/testing` now models that, so a test that presses a view committed again after it left the tree sees the press ignored, as it would be on a device.
