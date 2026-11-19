---
__default__: patch
---

On the GTK desktop host on Linux, the core owns the focus, as on macOS. Tab and Shift-Tab walk the core's Tab order, which reaches every focusable view, and stay inside the sheet, popover or sidebar pane the focus is in. The arrow keys, Home and End move inside a `tablist`, `radiogroup`, `menu`, `menubar`, `listbox` or `grid`. A view with `focusable` or a `tabIndex` takes the focus as a real GTK widget, so a screen reader hears it move, and a click focuses it too. Each view hears `focus` and `blur` however the focus moved, with `focusVisible` set when a key moved it, and draws a focus ring then. Focus an assistive technology moves is where the next Tab goes on from.
