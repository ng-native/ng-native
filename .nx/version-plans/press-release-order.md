---
'__default__': patch
---

A press that is let go is committed as no longer pressed before its handler runs, so what the handler changes is committed by the render pass after it and not a frame early with the press: an overlay a press opens is no longer drawn before it has been placed.
