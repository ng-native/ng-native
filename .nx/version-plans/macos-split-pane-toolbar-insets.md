---
__default__: patch
---

On macOS, a page in the content pane of a window's `<split-view>` now starts below the window's toolbar as soon as the toolbar appears, rather than under it until something else lays the pane out.

The toolbar changes the pane's safe area without changing its frame, so the pane did not lay out again and kept the inset it had before the toolbar (the title bar's alone). This showed on the first screen of a `<native-stack-outlet>` in the pane, with or without a `<screen-safe-area-view>`, since that screen mounts before the toolbar does. Each container in the window now measures its insets again when the toolbar comes, goes or changes.
