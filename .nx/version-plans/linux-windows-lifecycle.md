---
__default__: patch
---

On the GTK desktop host on Linux, an app runs once: launching it again raises its window and hands the running app the link or file it was launched on, which `DeepLinks` delivers, and the desktop entry of a deb, rpm or Flatpak is D-Bus activatable, with its D-Bus service and the MIME types a document type lists in its new `mimeTypes` option. A window comes back at its saved size, maximised or full screen, and never at a saved place, and the app quits with its last window unless `quitWhenLastWindowCloses: false` keeps it.
