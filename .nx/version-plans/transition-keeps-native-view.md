---
'__default__': patch
---

A text field focused while a view around it fades in keeps its focus: a plain view with a `transition` is now a native view for as long as it has one.

React Native gives a view a native view of its own for an opacity under 1 and takes it away at 1, moving everything inside it to the view above, and that move made a focused field lose its focus as the fade ended. From 0.7.0 this showed for `transition-[opacity]` with `opacity-0` taken off, which now eases where it jumped; a fade between two written opacities did it before then too. A view with a transition commits `collapsable: false`, unless `collapsable` is written on the element.
