---
__default__: patch
---

`Printing.print({ window })` prints what a window shows on macOS, web views included, from an `AppWindow`, with the print dialog as a sheet on that window; on other OSes it prints nothing and resolves. A video, the camera preview and Metal content print blank. The default menu bar gains File > Print... (Command-P), which prints the key window on macOS unless the app gives its own `print` item a handler, and Close Window moves into File, before Print..., when the app has a File menu.
