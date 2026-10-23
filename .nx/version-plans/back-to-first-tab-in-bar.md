---
__default__: patch
---

Android's back button, and NativeNavigation.back(), at the root of a tab now go to the first tab in the bar, rather than to a first tab an @if has taken out of it.

The first tab is read from the bar as it is when back is pressed: a tab an @if puts before the others becomes the one back goes to, and a first tab taken away and shown again is returned to where it was left. On the first tab in the bar, the button is declined, so Android leaves the app.
