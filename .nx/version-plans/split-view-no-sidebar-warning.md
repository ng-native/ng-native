---
__default__: patch
---

A `<split-view>` with no `<sidebar>` as a child of its own warns in development that its sidebar pane is empty. Before, nothing said so, and on macOS its children were laid out as a column with no divider.
