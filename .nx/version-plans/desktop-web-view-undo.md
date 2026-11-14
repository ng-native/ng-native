---
__default__: patch
---

On macOS typing into a page in a web view no longer quits the app: a focused web view keeps an undo history of its own, as a focused text input does, so Edit > Undo undoes the page's typing and the app's actions stay for when neither has focus.
