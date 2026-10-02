---
__default__: patch
---

A component with `ViewEncapsulation.None` has its CSS matched as a global sheet once it first renders, as a browser applies it, where its rules reached only the elements its own template created: its host's class rules, and rules for the app's elements, now apply.

- `:host` in such a sheet matches nothing, as in a browser, where it matched the host.
- The sheet comes after the app's global sheet and wins a tie with it; a component's own rule of the same selector still wins, by the extra class Angular's emulated encapsulation gives it.
- It stays registered once the last instance is gone, as with Angular's `REMOVE_STYLES_ON_COMPONENT_DESTROY` off. A hot swap of its CSS replaces it in place.
- `ViewEncapsulation.ShadowDom` stays scoped to the component, as a shadow root scopes it.
- `Engine.addGlobalSheet` and `StyleResolver.addGlobalSheet` are new.
