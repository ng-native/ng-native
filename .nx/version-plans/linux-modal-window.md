---
__default__: patch
---

On Linux a cover, and a sheet drawn over the window (libadwaita 1.4, or a window that cannot be resized), now hold the rest of the window still, as a sheet does on macOS. While one is shown, the header bar's items, the sidebar's header bar, the menu bar and the content behind it take no clicks and no keyboard focus, and F10 does not open the menus. The window controls still close, move and resize the window. A sheet over a cover holds the cover too. Everything takes input again once the last one closes.
