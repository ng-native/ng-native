---
'__default__': patch
---

A view's opacity or transform changed after a native animation of it has ended is drawn. Once a CSS transition, a `@keyframes` animation or a scroll-driven animation played on native had set either on a view, React Native drew no later commit of it: a keyframes fade that does not fill stayed at its last frame, and a later change of class or bound style left the view where the animation had put it. Each later change is now set on native as well as committed, except a transform written as a matrix, which native cannot set and which stays where the animation left it.
