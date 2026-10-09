---
'__default__': patch
---

`tw-animate-css` plays: an `animation` shorthand whose parts are each a token is read by what each falls back to, with its duration and delay following their tokens, and Tailwind's build leaves an animation's times and a keyframe's slots for the device, so `animate-in fade-in-0 zoom-in-95 duration-200` fades and zooms in over 200ms where the animation was dropped with a build warning.
