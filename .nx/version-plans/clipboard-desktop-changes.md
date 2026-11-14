---
__default__: patch
---

On macOS `Clipboard.changes()` in `@ng-native/expo` counts the pasteboard's changes from the desktop host's `ngNativeClipboard` event, where the service failed as it started because the host's module has no `addClipboardListener`.
