---
'__default__': patch
---

Five cases where the engine kept showing an old state now follow the change. An element put back in the tree after a class changed above it, `.dark .title`, is styled by the class as it is now. A change inside a `display: none` element reaches the next commit, so a panel hidden by `:has()` shows again once the `:has()` no longer holds. An endless `@keyframes` animation stops while its element, or one it is in, is `display: none`, with an `animationcancel` as a browser sends, where it kept a frame loop running, and plays again when shown. A scroll-driven animation drives its view again after the view or its scroll view was hidden and shown, where it froze on its first frame. A custom property bound with a `calc()`, `min()` or `max()` of lengths, a `rem`, an `em` or viewport length, a unitless line height or two to four lengths in `px` is read as the same text in a stylesheet, where it set nothing.
