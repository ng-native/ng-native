---
__default__: patch
---

An interaction event from `provideInteractionObserver()` in `@ng-native/components` now carries `component`, the selector of the nearest component the pressed control or dragged scroll view is rendered inside, so taps on every `<app-button>` can be grouped without a `testID` on each.

It is found only when an observer is registered and an interaction fires. It is absent for a control in the root component's own template, for a component that composes `PressBehavior` onto its own host (which `element` already names), and on the web host.
