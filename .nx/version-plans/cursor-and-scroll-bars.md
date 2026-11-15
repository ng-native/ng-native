---
__default__: patch
---

`cursor` takes every CSS keyword cursor, such as `text`, `grab`, `not-allowed`, the resize cursors and `zoom-in`, where it took `auto` and `pointer` alone: on macOS the host draws it, and iOS draws `auto`. An image cursor, `url(...)`, is dropped with a warning, where its fallback keyword was kept. `scrollbar-width` and `scrollbar-gutter` are read: `scrollbar-width: none` hides a scroll view's indicators on iOS and Android as well, and on macOS `thin` draws the small scroll bar and `scrollbar-gutter: stable` keeps room for one. `::-webkit-scrollbar` is dropped with a warning that names them.
