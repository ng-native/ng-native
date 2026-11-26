---
__default__: patch
---

A `<virtual-list>` sticky row that becomes sticky, or whose pinned range changes, while the list is at rest is now drawn in its place at once instead of at the next scroll, and sticky rows move along x once the list turns horizontal.

This applies wherever native moves sticky rows with the scroll, as on iOS and Android. Before, a row made sticky in a scrolled list stayed at its own place, and a row whose next sticky row changed, or whose rows above changed size, stayed where its old range put it, until the user scrolled. A list switched to `horizontal` with the same rows rendered kept moving its sticky rows along y.
