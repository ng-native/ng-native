---
__default__: patch
---

On Linux, a window the app gives no title is titled with the app's name, and the header bar over a `<split-view>`'s content shows the selected `<sidebar-item>`'s label.

The main window has no title unless `provideMainWindow` sets one, and a window the app opens can have none too; a window's title is what the desktop's taskbar, window switcher and screen reader show. The content's title follows the selected row across the sidebar's lists, and goes when the sidebar does. In a full-height split, the content's header bar also shows a window title the app sets, as it did over the whole window: it shows whichever was set last, the window's title or the sidebar's selected row, which a refill of the sidebar sets again even where the row is unchanged. Before, an untitled window had no title and the content's header bar read "Content".
