---
__default__: patch
---

On macOS the desktop host draws `<expo-image>`: the source that fits the view, `contentFit`, `contentPosition`, `tintColor`, `blurRadius`, a fade `transition`, blurhash and thumbhash placeholders, and a memory and disk cache by `cachePolicy`, with `expo-image`'s load events. A view whose `recyclingKey` changes from one key to another clears its image at once, as on iOS, so a reused view shows its placeholder rather than the last item's image while its own loads.
