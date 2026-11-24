---
__default__: patch
---

`<split-view>` has a `contentStyle` input, `plain` (the default, as before) or `inset`, which on macOS and Linux draws the content pane as a card with rounded corners on the sidebar's backdrop.

An inset pane sits 8 points in from the edges of the space beside the sidebar and below the toolbar or header bar, with a 10 point corner radius. On macOS the backdrop is the sidebar's material and runs under the toolbar, and the toolbar draws no separator over a window's split view; on Linux the content page takes the sidebar's colour, and the header bar over a window's split view draws no background or border of its own. The pane is laid out at the card's size, so a page in it starts below the toolbar without a hard-coded top margin. iOS, Android and the web host ignore the input.
