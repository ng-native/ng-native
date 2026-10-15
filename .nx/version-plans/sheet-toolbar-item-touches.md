---
'__default__': patch
---

Presses in a `ui-bottom-sheet`'s content keep working on iOS when a `ui-toolbar-item` is added to or removed from the sheet while it is open.

The sheet's content now stays in place as items come and go: where the build has SwiftUI's toolbar, a sheet not sized to its content keeps its navigation stack with no item in it, which draws no bar, and the toolbar sits beside the content rather than around it. A sheet sized to its content is still made again as its first item arrives or its last goes.
