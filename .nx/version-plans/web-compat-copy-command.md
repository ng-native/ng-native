---
__default__: patch
---

`document.execCommand('copy')` copies the text of the field a script has called `select()` on to the clipboard, through `expo-clipboard` when the app has it, so a "copy" button from a browser library works; it answers `false` without the module or for any other command.
