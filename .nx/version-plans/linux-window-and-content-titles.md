---
__default__: patch
---

On Linux, a window the app gives no title (the main window, unless `provideMainWindow` sets one) is titled with the app's name, which the desktop's taskbar, window switcher and screen reader show, rather than nothing. The header bar over a `<split-view>`'s content shows the selected `<sidebar-item>`'s label, rather than "Content".
