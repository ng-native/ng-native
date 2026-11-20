---
__default__: patch
---

On the GTK desktop host on Linux, `<split-view>` is now an `AdwNavigationSplitView` and its `<sidebar-section>`s and `<sidebar-item>`s are a source list the host draws, as on macOS.

Before, the sections and items drew their own rows on Linux and the panes had no size. The sidebar's width runs from `minWidth` to the width it starts at as the window allows, and is not dragged. Below the sidebar's narrowest plus 360 points the split view is a stack with the content in front: Show Sidebar (F9, or the header bar's sidebar button) brings the sidebar forward, and choosing an item there brings the content back. That is no collapse the app hears of. While wide, Show Sidebar collapses and opens the sidebar, which `[(collapsed)]` follows. A window with a split view keeps its back and forward pair with no header in front. `autosave` is ignored on Linux.
