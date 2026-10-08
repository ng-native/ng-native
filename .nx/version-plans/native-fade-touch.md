---
'__default__': patch
---

A view that takes a touch and fades to `opacity: 0` by a transition still hears a press on iOS: native ends the fade at the opacity the view is committed with, where it ended at none and iOS passed the view over.
