---
__default__: patch
---

A `<split-view>` with no `<sidebar>` warns once in development that it shows only its content, which on macOS has no divider and no second pane. Before, it laid its children out as a column with no warning.
