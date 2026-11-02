---
__default__: patch
---

Clamp a math function that comes out below zero to 0 on a property that cannot be negative, in a stylesheet, a `style` attribute, a `[style]` binding and a `calc()` of tokens, and refuse a length added to a number with a warning.

The properties are sizes, padding, `font-size`, `line-height`, `gap`, border and outline widths, border radii, `flex-basis`, `flex-grow`, `flex-shrink`, `aspect-ratio` and `opacity`. `width: calc(1px - 5px)` commits `0` where it committed `-4`. A margin, an inset and `letter-spacing` keep their negative.

A negative written out on one of these properties other than `opacity` in a stylesheet, such as `width: -4px`, is now dropped with a warning, as a browser drops it, where it was committed. `opacity` clamps a negative however it is written. A token or fallback that holds a negative written out and is used whole on one other than `opacity`, `width: var(--t)` with `--t: -4px`, leaves the declaration unset, in a stylesheet and set on an element, as it is invalid there in a browser. A fallback in `em` or a viewport unit is clamped to 0 instead.

A stylesheet `calc()` or `min()` that mixes a length and a number, such as `width: calc(1px + 2)`, is dropped with a warning where it compiled to a length.

In a `style` attribute or a binding, a math function CSS refuses, by its types or for the property, is dropped where it was left as text over a stylesheet's value, and warns in development. That covers a transform with such a function in its arguments, which was already dropped.

`flex: calc(1 - 2)` in a style is a grow of 0 where it was refused, and `line-height: calc(1 - 2)` is 0 where it was a negative multiple.
