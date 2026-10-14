---
'__default__': patch
---

`<ui-date-picker [displayedComponents]>` works on Android. Compose takes one word for what the picker shows, `date`, `hourAndMinute` or `dateAndTime`, where SwiftUI takes a list, and the list was passed to both, so Android refused the prop with an error.
