---
__default__: patch
---

On Linux a `<sidebar>` with `autosave` keeps whether it is collapsed across launches, as on macOS, and the app hears a restored state through `collapsed`; there is no width to keep, since the sidebar has no divider to drag. Beside the content, the sidebar button sits over the full-height sidebar, at the end of its own header bar, and moves to the window's header bar once the sidebar folds away. A cover beside a full-height split view now starts below both header bars, where it covered the sidebar's header bar and window controls.
