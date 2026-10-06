---
'__default__': patch
---

A field that already has the focus does not hear a second `focus` event for it.

A `topFocus` for the node the engine already holds as focused is dropped before any listener runs, so a focus dispatched from JavaScript and native's answer to it are one event. A focus after a blur, or on another field, is heard as before.
