---
__default__: patch
---

`ColorScheme.set()` now takes effect at once for `ColorScheme.current()` and `.dark` styles, including inside a full-screen `<modal>` on iOS, where it waited for the modal to close.

On iOS React Native reports an appearance change only from its root view, which a full-screen modal takes out of the window. A system switch while one is open still arrives when it closes.
