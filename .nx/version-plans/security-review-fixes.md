---
__default__: patch
---

Fixes from a security review.

- `@ng-native/web-compat`: `XMLSerializer` escapes the namespace it writes in an `xmlns` attribute, so a namespace holding a quote or markup can no longer add attributes or elements to the output.
- `@ng-native/web-compat`: only an `<iframe>` in the HTML namespace becomes a web view or an emulated frame. One in SVG or MathML, such as one inside an SVG image's markup, or one made with `createElementNS` in another namespace, is a plain element, and its `srcdoc` is not loaded.
- `@ng-native/web-compat`: a message from a web view whose sender URL cannot be parsed, such as an opaque frame's `null`, arrives with the origin `null` instead of the frame's own origin.
- `@ng-native/web-compat`: an emulated frame more than ten frames deep stays blank, so a page that frames itself no longer loads without end.
- `@ng-native/web-compat`: `DOMParser` parses XML that declares a namespace prefix on every level of deep nesting in time that grows with the declarations instead of with their square.
- `@ng-native/router`: `fileRoutes` runs a page's `canMatch` guards with the providers in its `routeMeta`, eager or lazy, as Angular runs a route's guards with its own providers.
- `@ng-native/components`: the Markdown component compares each changed block once when a new `source` arrives, where deeply nested blocks such as quotes inside quotes cost three times more for every level.
- `@ng-native/tailwind`: a `var()` name holding a character that has a meaning in a regular expression, such as `--a**`, no longer stops the build with a `SyntaxError`. A line break in the Tailwind entry's file name no longer ends the generated module's header comment.
- `@ng-native/metro`: the dev server keeps a parked route history exactly as the app sent it, so a deeply nested body can no longer crash the server.
