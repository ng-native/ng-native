---
__default__: patch
---

`<virtual-list>` and `<section-list>` no longer mark the screen holding them for change detection on every scroll event.

The list used to listen for scroll events as an Angular host listener, which marks the list and every view above it for checking on each event, so a fling checked the whole screen every frame. Now a scroll event checks only what its signals change: the window when rows come and go, and sticky rows while one is pinned. A `(scroll)` or `(endReached)` handler bound in a template still runs and still updates its view. A plain field written outside Angular's events that only showed up because the list scrolled now waits for the next change detection, as it does anywhere else in a zoneless app.
