---
'__default__': patch
---

A `<virtual-list>` or `<section-list>` with `listHeader` or `listFooter` content no longer stops the app on Android with "ScrollView can host only one direct child". The header, the rows and the footer are held by one content view, as `<scroll-view>`'s children are, so the native scroll view has a single child on both platforms.
