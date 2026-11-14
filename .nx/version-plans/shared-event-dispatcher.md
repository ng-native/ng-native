---
__default__: patch
---

`@ng-native/fabric` gives every surface on a runtime one event dispatcher, which registers with Fabric once and hands each event to the engine that made its target. With two surfaces, such as two desktop windows, the later one no longer takes the earlier one's events. `Engine.leaveEvents()` stops a surface's engine taking events as the surface goes.
