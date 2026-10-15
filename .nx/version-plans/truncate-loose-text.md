---
'__default__': patch
---

Text written straight into a view is truncated as the view says, as a browser truncates a block's own text. `<view class="truncate">` or `line-clamp-2` around its own words, or a `numberOfLines` bound on it, left the words untruncated, because the paragraph they are drawn in never took the view's `numberOfLines` or `ellipsizeMode`.
