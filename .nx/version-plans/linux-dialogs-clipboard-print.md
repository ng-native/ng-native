---
__default__: patch
---

On the GTK desktop host on Linux, `DocumentPicker` opens, saves and chooses folders through the desktop's FileChooser portal, `Clipboard` uses the desktop's clipboard instead of one of its own, and `Printing` prints a window (including from File > Print), an image or a PDF; `print({ window })` now prints on Linux as well as macOS.
