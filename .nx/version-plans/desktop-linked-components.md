---
__default__: patch
---

On macOS a linked library's Fabric components are compiled into the desktop host from its codegen, as on Android, so they lay out and their events reach JavaScript. The library draws one with a subclass of `NGNView` from the host's `component-view.h`, registered for the component's name with `NGNRegisterComponentView`; a component with none registered is drawn as a plain view.
