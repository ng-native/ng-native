---
__default__: patch
---

On Linux, `Accessibility.announce()` is said by a screen reader on GTK 4.14 and later, through the app's front window: the GTK host dropped it before. A view a screen reader can press, increment, decrement or cancel offers that as an AT-SPI action (`accessibility.press`, `accessibility.increment`, `accessibility.decrement`, `accessibility.cancel`), enabled while the view offers it and is not disabled, and sent as macOS sends VoiceOver's: its `onAccessibilityTap`, `onAccessibilityEscape` or declared action, or a click.
