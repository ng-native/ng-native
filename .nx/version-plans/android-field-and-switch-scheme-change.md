---
__default__: patch
---

On Android, a `text-input` or `switch` already on screen now follows an in-place light or dark change: a field's selection colour, cursor and selection handles, and a switch's press ripple. Before, they kept the colours of the scheme they were created in until the screen was made again. A `selectionColor`, `cursorColor` or `selectionHandleColor` set on the field stays. The cursor and handles follow on Android 10 and later only.
