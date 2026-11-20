---
__default__: patch
---

On Linux with GTK 4.14 or later, a screen reader reads a `<text>` by character, word, sentence, line and paragraph, as it reads GTK's own labels: the GTK host gives a text's widget GTK's `GtkAccessibleText`, found at run time, and tells the screen reader when the text changes. Below GTK 4.14 a text is read by its name, as before. A text input's field already reads this way, through GTK's own field on GTK 4.14 and later.
