---
__default__: patch
---

On iOS, `Brightness.restore()` and the function `Brightness.set()` returns now put back the level the screen had before a level was set. Before, they called expo-brightness's `restoreSystemBrightnessAsync()`, which does nothing on iOS, so a screen set to full brightness for a boarding pass stayed at full brightness after the app until the device locked. The level is read when a `set()` comes while no app holds a level, and a change made in Control Center while a level is held is undone when it is put back. Leaving the app while a level is held still keeps that level until the device locks. Android is unchanged.
