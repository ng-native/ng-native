---
__default__: patch
---

`InteractionEvent.component` is set on the web host too, naming the component around a tapped control as it is on iOS and Android.

`@ng-native/web` marks each component's host element as the native renderer does, and the root component is told by being the outermost component rather than by its depth under a surface, so a control in the root component's own template still reports no `component` on either host.
