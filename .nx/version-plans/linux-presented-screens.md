---
__default__: patch
---

On the GTK desktop host on Linux, a screen presented with `present()` shows as it does on macOS: as a sheet (an `AdwDialog` on libadwaita 1.5 and later in a resizable window, a drawn sheet over the dimmed window on 1.4 or in a window that is not resizable), as a cover below the header bar, or, with an `anchor`, as a `GtkPopover` pointing at the anchor, which a `<modal>` with an `anchor` now also is. A presented screen's header is the sheet's own header bar: its title, its left items at the start with the first bound to Escape, and its right items at the end with the last the default on Return. Without such an item, Escape dismisses the screen, as does a click outside a popover, and the router follows.

A header bar button with a `menu` opens it as a GTK menu on Linux, and the header's `color`, `titleColor` and `backgroundColor` reach the header bar's buttons, title and background. A window opens with nothing focused on Linux, as on macOS, so a header's search field no longer takes the focus and reports it at launch.
