---
'__default__': patch
---

An icon's `size` is read with the unit a web app writes it with: `size="18px"` or `size="1.5rem"`.

`@ng-icons/core` documents the size as a CSS length. Read as a number alone, `18px` was not one, and the icon was drawn with no size at all. One that cannot be read is now left the size of the text around it.
