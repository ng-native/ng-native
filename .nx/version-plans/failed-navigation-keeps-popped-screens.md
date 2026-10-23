---
__default__: patch
---

A navigation back to a screen further down the stack that fails now puts back the screens it took off, and a failed navigation no longer leaves a second history entry for the page showing.

Before, the screens above the kept screen were destroyed as the navigation started, so a failure left the router on the old url with that screen gone, and the next navigation could stack an empty screen. They are now kept until the navigation succeeds, as a replaced screen already was, and a cancel after the screen is shown, from a page that navigates as it is created, still takes them off. A navigation that wrote its url and then failed, or was refused by a guard with `urlUpdateStrategy: 'eager'`, including one a guard redirected to a page that fails or refuses it, no longer leaves that url's entry behind as a copy of the one before it, with the default `canceledNavigationResolution: 'replace'`. Back right after a failed navigation now goes back from the screen showing, including a screen whose page underneath failed; before, it did nothing.
