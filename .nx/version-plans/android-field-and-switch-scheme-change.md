---
__default__: patch
---

On Android, a `text-input` or `switch` already on screen now follows an in-place light or dark change: a field's selection colour, cursor and selection handles, and a switch's press ripple.

Before, they kept the colours of the scheme they were created in until the screen was made again. A `cursorColor` or `selectionHandleColor` set on the field stays, and so does a `selectionColor` unless it is the old scheme's own selection colour, which then follows the scheme. A switch with `thumbColor` keeps the ripple React Native gives it, and one with a `backgroundColor` keeps that background's ripple. The cursor and handles follow on Android 10 and later only.
