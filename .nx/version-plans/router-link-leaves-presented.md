---
'__default__': patch
---

A `nativeRouterLink` inside a page presented over another tab now leaves that page, as `push()` from it does: the link goes to its url's own tab and the page is dismissed. An absolute link from the page no longer lands on the page's own url.
