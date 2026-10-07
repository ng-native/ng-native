---
'__default__': patch
---

`max-content` is read as a size: `width` and `height` as `fit-content`, and `max-width` and `max-height` as a cap that keeps a box that would fill its container to its content.

Tailwind's `w-max`, `h-max`, `max-w-max` and `max-h-max` were dropped with a warning. A box is as big as its content along its container's main axis already, so `max-content` is the same as `fit-content` here. A `max-width: max-content` beside a width in points leaves the width as written, since the content is not measured. `min-content`, and `max-content` as a minimum, are still refused.
