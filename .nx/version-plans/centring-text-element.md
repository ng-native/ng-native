---
'__default__': patch
---

A text element that is a flex container and holds one text element places it, as it places a run of text.

`<span class="content"><span class="label">First</span></span>` with `display: flex; align-items: center; height: 48px` on the outer span was committed as one paragraph, so the label sat at the top. The outer span is now a view around the inner one's paragraph, which the alignment centres, and is one paragraph again once it stops aligning.
