---
__default__: patch
---

On macOS, a `<sidebar-item>` has a read-only `emphasized` signal, and its host has `data-emphasized`, while its selection is drawn in the accent colour, so a custom row can restyle itself for the grey selection of an inactive window or an unfocused sidebar.

The host sends `topSidebarEmphasis` with `{ emphasized }` to an item as that changes. `emphasized` is always false on other platforms.
