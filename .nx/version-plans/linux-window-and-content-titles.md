---
__default__: patch
---

On Linux, a window the app gives no title is titled with the app's name, and the header bar over a `<split-view>`'s content shows the selected `<sidebar-item>`'s label.

The main window has no title unless `provideMainWindow` sets one, and a window the app opens can have none too; a window's title is what the desktop's taskbar, window switcher and screen reader show. The content's title follows the selected row across the sidebar's lists, and goes when the sidebar does. In a full-height split, a window title the app sets is shown over the content instead, as it was over the whole window. Before, an untitled window had no title and the content's header bar read "Content".
