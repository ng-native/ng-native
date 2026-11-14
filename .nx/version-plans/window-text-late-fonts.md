---
__default__: patch
---

`@ng-native/platform` lays out again the text in a desktop window (`AppWindows`, on macOS) that names a font face registered after the window drew, as it already did for the app's own surface. The window's text stayed measured in the fallback face, so a taller face was clipped.
