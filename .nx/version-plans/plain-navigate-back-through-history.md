---
__default__: patch
---

A plain Router.navigate() or navigateByUrl() to a url further down a native stack now goes back through history to that screen's entry, as popTo() does, so the history no longer keeps entries for the screens it takes off and Back goes to the screen below.

The screen already there is still the one shown, and the stack does not grow. The entry keeps the state it was pushed with, the screen's presentation included. The navigation still resolves true. A navigation with skipLocationChange leaves the history as it is, and so does one from a stack inside a tab whose history went through another tab since that screen was shown, where the entry that far back is the other tab's. An app whose router sets canceledNavigationResolution to 'computed' keeps the history as before, since the router counts its own entries there.
