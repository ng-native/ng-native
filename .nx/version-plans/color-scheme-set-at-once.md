---
__default__: patch
---

`ColorScheme.set('light')` and `set('dark')` now take effect at once for `ColorScheme.current()` and `.dark` styles, including inside a full-screen `<modal>` on iOS, where they waited for the modal to close.

On iOS React Native reports an appearance change only from its root view, which a full-screen modal takes out of the window. `set(null)` and a system switch while one is open still arrive when it closes. A subscriber hears each scheme once, though the platform repeats it.
