---
__default__: patch
---

`<sidebar-section>` takes `[(collapsed)]`, which starts a collapsible section folded, folds or opens it from code, and follows the user folding or opening it, on macOS, Linux and where the sidebar is drawn.

It is `false` by default. The section takes the app's value when it is first shown and whenever the value changes, and otherwise stays as the user left it. A section that is not collapsible, or has no title, always shows its items. On macOS and Linux the user folding or opening a section sends `topSidebarSectionCollapse` with `{ collapsed }`.
