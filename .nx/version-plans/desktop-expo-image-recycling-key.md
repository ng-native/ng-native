---
__default__: patch
---

On macOS an `<expo-image>` whose `recyclingKey` changes from one key to another clears the image it shows at once, as on iOS, so a reused view shows its placeholder rather than the last item's image while its own loads.
