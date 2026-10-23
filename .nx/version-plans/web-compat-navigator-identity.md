---
__default__: patch
---

With `provideWebCompat()`, `navigator.userAgent` names a phone of the platform the app runs on and `navigator.maxTouchPoints` is set while the app is up, so a library that picks touch handling from them, such as Highcharts, treats the app as a touch device.
