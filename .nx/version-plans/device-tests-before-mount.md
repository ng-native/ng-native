---
__default__: patch
---

`startDeviceTests()` takes a `beforeMount` function that the device test host waits for before it mounts, such as `() => loadFonts(styles)`, so tests and their screenshots render in the app's own faces rather than in the fallback one.

The host calls it each time it mounts, as it does a `mount` function. When it rejects, the host still connects to Vitest, shows the error on screen, and fails each test file it is sent with that error; an app that would rather run in the fallback face catches the rejection itself, `() => loadFonts(styles).catch(() => undefined)`.
