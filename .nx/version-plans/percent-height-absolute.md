---
'__default__': patch
---

A percentage height on an absolutely positioned box is kept where the box that holds it has no height written.

`position: absolute; height: 100%` under a parent sized by its content had its height removed, as a percentage height in the flow is, so the box had no height. A box out of the flow takes the percentage of the box that holds it, which is laid out first, so the percentage is now left for Yoga to resolve.
