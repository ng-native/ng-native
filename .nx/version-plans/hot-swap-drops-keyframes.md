---
__default__: patch
---

A hot swap that deletes or renames a component's `@keyframes` stops the animations naming them, as a browser does, where the old keyframes stayed registered and kept playing until the app reloaded.

- It applies to emulated and Shadow DOM component sheets and to `ViewEncapsulation.None` ones, on a hot swap that edits the CSS, removes it, or changes the encapsulation.
- A name another sheet also defines falls back to that sheet's keyframes, and a swapped sheet keeps its place among the others, so the later of two sheets still wins.
- An animation whose keyframes the swap edits carries on along the new frames on its own clock, a scroll-driven one included, and a finished one holding its last frame lets it go when its keyframes are deleted.
- `Engine.sheetReplaced` is new: it tells the engine a hot swap replaced one sheet with another, or with none.
