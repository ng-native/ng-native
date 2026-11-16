---
__default__: patch
---

On macOS the arrow keys, Home and End move the focus inside a view with the `tablist`, `radiogroup`, `menu`, `menubar`, `listbox` or `grid` role, which Tab treats as one stop, and any `tabIndex`, -1 included, lets a view take the focus. The focus moves into a sheet, in-window cover or popover as it opens, Tab stays inside it, and the focus goes back to the view that had it when it closes. The `listbox`, `gridcell`, `menuitemcheckbox` and `menuitemradio` roles, which React Native drops, reach VoiceOver.
