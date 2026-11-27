---
__default__: patch
---

On macOS, an inset content card (`contentStyle="inset"`) runs up to 8 points from the window's top in a window made with `titleBar: 'hidden'` that has no toolbar, and a window whose sidebar has `[toggleButton]="false"` has no toolbar unless a header or history fills one.

Before, a window with a split view always had a toolbar for the sidebar button, so the card started below it, about 52 points down. The toolbar now shows only while it holds the sidebar button, a `<native-header>`, or the back and forward chevrons. With a title bar that shows its title, or with a toolbar, the card still starts below them. Each window's toolbar also has an identifier of its own, so AppKit no longer carries one window's toolbar items into another's.
