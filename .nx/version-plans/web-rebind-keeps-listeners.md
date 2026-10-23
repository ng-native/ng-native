---
__default__: patch
---

A `<text-input>` on the web host keeps the listeners and `IntersectionObserver` observations added to it through its node when `multiline` changes, so an `@defer (on interaction | hover | viewport)` trigger on it still loads its content.

Switching `multiline` replaces the field's `<input>` with a `<textarea>`, or back. Listeners added with the node's `addEventListener` and observations made by passing the node to an `IntersectionObserver` now move to the new element and leave the old one, as the engine's own listeners already did. A `once` listener that already fired, or one whose `signal` aborted, is not added again.
