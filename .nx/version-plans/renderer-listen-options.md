---
__default__: patch
---

A listener a script adds with `Renderer2.listen` keeps the options it was given, so under `@ng-native/web-compat` a document `touchmove` listener that says it is not passive keeps a drag from the page, as CDK's drag and drop does, where the page used to scroll under the dragged item. A renderer extension's `listen` hook is passed the options as its last argument.
