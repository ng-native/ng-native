---
__default__: patch
---

A value set on an element that a browser drops, such as `[style.width]` going from `40px` to `-4px` or `[style.padding]` to `1px -1px`, now leaves the value set before it, as Chrome's `setProperty` does, where it took that value away so the stylesheet's showed.

This holds for a single property, a shorthand of sides such as `padding`, and a shorthand of mixed parts such as `border` or `background`, and for a previous value that was a `var()`. The dropped value is still reported with a warning in development. Removing the binding takes the earlier value away, as before.

In a keyframe, a `box-shadow` or a colour such as `background-color` in `currentColor`, which a frame refuses, now leaves the value the frame gave before it, as any other refused value does, where it took that value away, and a shorthand such as `outline` keeps all of its earlier parts. A frame's `color: currentColor` no longer drops a later declaration with a value worked out on the device, such as `width: 1em`, nor is it dropped by one. In development, a `box-shadow` in `currentColor` where the colour in scope is a platform colour, such as `CanvasText` or `platform-color()`, including through an unset inset token as in Tailwind's ring, is now said to be dropped, where it was dropped with nothing said.
