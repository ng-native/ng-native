---
__default__: patch
---

An element that `@ng-native/web-compat` moves to another parent while a finger is on it keeps its touch: the document has it where it was put at once, and native is told when the finger lifts, so a drag that puts its element on the body as it begins, as CDK's drag and drop does, goes on.
