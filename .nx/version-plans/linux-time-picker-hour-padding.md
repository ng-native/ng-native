---
__default__: patch
---

On the GTK desktop host on Linux, a time picker on a 12-hour clock writes a one-digit hour with no padding in front of it, where a GLib that pads with a figure space (2.88) left one before the hour.
