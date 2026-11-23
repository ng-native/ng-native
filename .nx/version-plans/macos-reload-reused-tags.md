---
__default__: patch
---

On macOS, a reload (Developer > Reload, a reload from the dev server, or Fast Refresh falling back to one) now lays out a `<split-view>`'s sidebar and content panes at the sizes the window gives them, as a fresh launch does.

The reloaded app numbers its views from the start again, so its panes take the tags the old ones had. The macOS host kept the last size it passed on for each tag and skipped a size equal to it, so the new panes never got theirs: the sidebar was laid out above the content, and content such as a full-width `<scroll-view>` came out wider than its pane. The host now forgets a pane's size, and a scroll view's scroll bar gutter, when the view is deleted. A scroll view's gutter is no longer forgotten as its view is freed, which can happen after a reloaded scroll view under the same tag has recorded its own gutter.
