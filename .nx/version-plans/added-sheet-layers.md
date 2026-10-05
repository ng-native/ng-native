---
'__default__': patch
---

A component whose CSS is not scoped and names a cascade layer, as the CDK's overlay styles do, no longer has every view in the app styled again when it first renders, nor does one whose views join the tree in the same commit as its sheet. The first menu, select or dialog to open on a screen waited several hundred milliseconds for that.
