---
__default__: patch
---

The web host in `@ng-native/web` keeps a component's `interactionName` off its DOM element, as iOS and Android keep it off the native view, while interaction reports still read it.
