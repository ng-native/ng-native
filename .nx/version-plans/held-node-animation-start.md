---
'__default__': patch
---

An `@keyframes` animation on an element held unseen for a frame (what `provideWebCompat()` does for an overlay a library inserts) now starts when the hold lets go, as a browser starts it when it first paints the element, rather than as the element is inserted. Started under the hold, an animation of opacity that React Native's animated module played natively set the view's opacity over the hold's, so a fade-out showed the overlay whole through the frame it was meant to be unseen. Its clock starts from the release, so it ends a frame later than before.
