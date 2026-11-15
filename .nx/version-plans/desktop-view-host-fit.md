---
__default__: patch
---

On macOS a `<ui-view-host [matchContents]="true">` takes the size of the app's views it holds, as on iOS, rather than stretching across its `<ui-host>` and pushing the SwiftUI content beside it out of place.
