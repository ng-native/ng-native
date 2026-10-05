---
'__default__': patch
---

`:empty` matches an element whose only child is a text node with no characters, which is what `<span>{{ label }}</span>` holds while `label` is empty, and the element is restyled when the text gets its first character or loses its last. Any text node, an empty one included, used to stop the match.
