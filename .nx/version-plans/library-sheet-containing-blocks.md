---
'__default__': patch
---

In a library's sheet under `provideWebCompat()`, `will-change`, `contain`, `perspective` and `backdrop-filter` are no longer dropped: the engine reads them to place the absolute elements inside a static box, and sends none of them to a native view.

A `perspective` or a `backdrop-filter` other than `none`, and a `contain` of `size`, `inline-size`, `paint`, `strict` or `content`, are kept with a warning that native does not draw or contain that part. Any of the four whose value reads a token is still dropped with a warning, as all four still are from an app's own sheet. `element.style`, a `style` attribute and a `[style.x]` binding no longer send them to the native view either.
