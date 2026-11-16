---
__default__: patch
---

On an iPad, a `<split-view>` brings its sidebar back when its window gets wider again, after a narrower width or a compact one had hidden it, and that hiding no longer sets the sidebar's `collapsed` to `true`.

`collapsed` still follows the sidebar button and the swipe that opens or shuts the sidebar, and a sidebar the user shut stays shut as the window's size changes.
