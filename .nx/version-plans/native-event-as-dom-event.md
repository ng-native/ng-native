---
__default__: patch
---

`@ng-native/web-compat` now tells a listener a script added with `addEventListener` for an event native sends, such as `focusin`, the DOM event a browser gives, with `target`, `currentTarget` and `composedPath()`, the path it went up from where it was sent. Taiga UI's dropdown reads `composedPath()[0]` of the `focusin` its text field hears to tell where the focus went.
