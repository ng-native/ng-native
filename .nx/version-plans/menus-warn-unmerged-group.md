---
__default__: patch
---

A `<menu-group>` named as a default menu (such as `label="File"`) but with no `menuRole` now logs a warning that it is drawn as a second menu of that name, and that `menuRole="file"` adds its items to the File menu instead.
