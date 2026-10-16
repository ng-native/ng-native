---
__default__: patch
---

`(contentSizeChange)`, `(scroll)` and `(keyPress)` on a `<text-input>` fire on Android, where the native field was never asked to send them.

Android's text field sends each only when the `onContentSizeChange`, `onScroll` or `onKeyPress` prop is set, as React Native's `TextInput` sets it when a handler is passed. A field that listens for one of them now commits that prop on Android. iOS is unchanged: its field reports content size when the field itself changes size, as React Native's does, and the input docs now say so.
