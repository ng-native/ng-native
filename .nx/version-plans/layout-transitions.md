---
'__default__': patch
---

A CSS transition of a size or a place (`width`, `height`, margins, insets, `flex-basis`) is one commit, which native animates, where nothing else in that commit moves a box.

It was a commit on every frame from JavaScript. Native's layout animation has four curves (linear, ease-in, ease-out, ease-in-out), so a transition with a `cubic-bezier()` of its own is played by the nearest of them when native lays it out. Where another box is resized in the same commit, text changes length or an element comes or goes, the transition is eased from JavaScript by its own curve, as before.
