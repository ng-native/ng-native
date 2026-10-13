---
'__default__': patch
---

`present()` of another tab's page, asked for while the app's first screen is still loading, shows the page over the first tab, as the same call made a moment later does.

Asked at launch, with a lazily loaded tab bar not up yet, the page opened inside its own tab instead: the tab was selected and the page became the first screen of its stack. `present()` now waits for the first screen, as `push()` already did.
