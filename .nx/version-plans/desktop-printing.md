---
__default__: patch
---

On macOS `Printing` prints through the desktop host's `NgNativePrint`, over NSPrintOperation: `print()` shows the print panel for HTML, a PDF or an image, and `printToPdf()` writes the HTML's pages to a PDF. `selectPrinter()` answers null, as macOS has no printer picker.
