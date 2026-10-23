---
__default__: patch
---

A `<touchable-opacity>` eases back after a press to the opacity its classes or style give it, where one dimmed by a class eased up to 1 first, and one given an opacity by an inline `[style]` or a bound `[style.opacity]` now dims while pressed.

The resting opacity is whatever the cascade resolves when the press ends, from a component's sheet, a global sheet such as Tailwind's, an inline `[style]` or a bound `[style.opacity]`, and a change to it while the control is pressed or fading back is followed. A Tailwind `opacity-*` class on the control now applies at rest, where the component's own `opacity: 1` rule outranked it. The component no longer commits `opacity: 1` at rest when nothing sets an opacity, which native draws as 1 all the same.
