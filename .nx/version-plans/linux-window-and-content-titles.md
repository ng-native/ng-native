---
__default__: patch
---

On Linux, a window the app gives no title is titled with the app's name, and the header bar over a `<split-view>`'s content shows the selected `<sidebar-item>`'s label.

A window with no title is the main window unless `provideMainWindow` sets one; its title is what the desktop's taskbar, window switcher and screen reader show. The content's title follows the selected row across all of the sidebar's lists, and goes when the sidebar does. Before, the window had no title and the content's header bar read "Content".
