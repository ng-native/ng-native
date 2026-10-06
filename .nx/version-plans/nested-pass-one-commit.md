---
'__default__': patch
---

A `detectChanges()` called from a lifecycle hook no longer commits the screen on its own.

Angular tells the renderer when each change-detection pass ends, and the renderer committed every time, including a pass a component begins on itself from `ngAfterViewInit` while the application's pass is still running. A library that does this in each of its components committed the whole screen once for every one of them as the screen was first built. A pass begun inside another is now part of it, and the screen is committed once, when the outermost pass ends. A `detectChanges()` with no pass around it commits as before.
