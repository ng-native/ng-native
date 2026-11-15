---
__default__: patch
---

`@ng-native/components` adds drag and drop on macOS and iPadOS: the `FileDrop` directive's `(fileDragEnter)`, `(fileDragLeave)` and `(fileDrop)` take files, text and urls dragged onto a view, and `[dragItem]` lets a view be dragged out as files, text or a url. On iPhone, Android and the web host neither does anything. In `@ng-native/testing`, `userEvent.dropFiles` drives a `FileDrop` view.
