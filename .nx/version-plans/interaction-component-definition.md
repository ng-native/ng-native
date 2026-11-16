---
__default__: patch
---

`InteractionEvent.component` now names routed pages, the component that declares a native tab bar for a tab tap, and components matched by an attribute selector.

The component is read from the definition Angular mounted on each host, by its selector, rather than from the host element's name. A control on a page shown by `<native-stack-outlet>` or `<native-tabs-outlet>` reports that page, where it reported the component around the outlet or none. A tap on a native tab reports the component whose template declares the tab bar. A component with a selector such as `section[x-card]` is reported by that selector, where it was skipped as a plain view. A page with no selector reports no `component`. An element web-compat keeps a plain view, such as an emulated `<iframe>`, is never reported as a component.
