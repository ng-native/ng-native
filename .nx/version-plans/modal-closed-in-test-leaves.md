---
__default__: patch
---

A `<modal>` a test closes now leaves the tree before the interaction resolves, because the fake Fabric in `@ng-native/testing` reports the dismissal as iOS does and `settle()` waits for the commit that follows.

The fake sends `topDismiss` as soon as a `ModalHostView` is committed with `visible: false`, so `(dismiss)` fires and `screen.queryByText` no longer finds the modal's content, with no `fireEvent(host, 'dismiss')` in the test. A test that still sends it by hand sees `(dismiss)` once. `settle()`, and with it `fireEvent`, `userEvent` and `detectChanges`, also waits for a commit the engine owes outside change detection, which lands on the next frame, so such an interaction can take up to a frame longer to resolve.
