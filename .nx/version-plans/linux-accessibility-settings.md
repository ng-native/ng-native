---
__default__: patch
---

On the GTK desktop host on Linux, `AccessibilityInfo` reads the desktop's settings and follows them as they change.
- Reduce motion comes from the settings portal's `reduced-motion`, GTK 4.22's `gtk-interface-reduced-motion`, or GNOME's Animations switch turned off.
- Increase contrast comes from the desktop's high-contrast setting, through libadwaita, or GTK 4.20's `gtk-interface-contrast`.
- The screen reader setting comes from AT-SPI's status.
- Reduce transparency, invert colours, bold text and grayscale report off, as Linux has no such settings.

`AccessibilityInfo.announceForAccessibility` and live regions speak through `gtk_accessible_announce` on GTK 4.14 and later. Below 4.14, as on RHEL 9's GTK 4.12, nothing is said.

A `TextInput` is now one text box named by its `accessibilityLabel`, rather than a labelled group around an unnamed field.
