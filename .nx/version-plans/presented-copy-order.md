---
__default__: patch
---

A page of another tab presented with `present()` is the page its url names, whatever was presented before it: presenting `/library/new` after `/library/7`, where the tab has `new` before `:id`, showed the `:id` page with `id` set to `new`. The route a presented page is copied to at the root now goes before a copy made earlier that would also take its url.
