---
__default__: patch
---

On iOS, a `position: fixed` box as wide as its content wraps its text in its page, as in a browser and on Android, where it wrapped in a narrower box it was written in.

Such a box, one with no width of its own and not stretched between a `left` and a `right`, is now committed under its page on iOS, as a fixed box inside a scroll view already was. There it draws over the page's other content and an ancestor's `opacity` or `transform` no longer reaches it. One moved there for its width alone goes back under its parent once it has a width of its own.
