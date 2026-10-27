---
__default__: patch
---

Fixes from a security review.

- `@ng-native/web-compat`: `XMLSerializer` escapes the namespace it writes in an `xmlns` attribute, so a namespace holding a quote or markup can no longer add attributes or elements to the output.
- `@ng-native/web-compat`: only an `<iframe>` in the HTML namespace becomes a web view or an emulated frame. One in SVG or MathML, such as one inside an SVG image's markup, or one made with `createElementNS` in another namespace, is a plain element, and its `srcdoc` is not loaded.
- `@ng-native/web-compat`: on Android, a message from a frame inside a web view's page that reports its origin as `null` arrives with the origin `null` instead of the web view's own origin. A `srcdoc` page loaded with no base, which Android also reports as `null`, is still heard from the app's origin.
- `@ng-native/web-compat`: a message posted to an iframe for an origin (not `*`) waits until the page its new `src` or `srcdoc` names has loaded. On Android, one posted as `srcdoc` replaced a `data:` page reached that page.
- `@ng-native/web-compat`: on iOS, an iframe whose `src` has no host, such as a `data:` URL, is shown as an empty page with a warning. react-native-webview there threw on it and closed the app.
- `@ng-native/web-compat`: an SVG `<img>` in a template's content, a `DOMParser` document or markup `setHTML` is sanitizing is not fetched until it is put in a document that loads it.
- `@ng-native/web-compat`: an emulated frame more than ten frames deep stays blank, so a page that frames itself no longer loads without end.
- `@ng-native/web-compat`: `DOMParser` parses XML that declares a namespace prefix on every level of deep nesting in time that grows with the declarations instead of with their square.
- `@ng-native/router`: native tabs leave a tap on a tab that was visited and sits behind an activation guard to the router: the tab is selected once the guard agrees, instead of showing its kept page while the guard runs. This needs react-native-screens 4.30 or later; earlier versions select at once as before.
- `@ng-native/router`: a page `present()` shows over another tab runs each guard of the routes above it with the providers down to that route, not with the page's own.
- `@ng-native/router`: `fileRoutes` runs a page's `canMatch` guards with the providers in its `routeMeta`, eager or lazy, as Angular runs a route's guards with its own providers.
- `@ng-native/components`: the Markdown component compares each changed block once when a new `source` arrives, where deeply nested blocks such as quotes inside quotes cost three times more for every level.
- `@ng-native/tailwind`: a `var()` name holding a character that has a meaning in a regular expression, such as `--a**`, no longer stops the build with a `SyntaxError`. A line break in the Tailwind entry's file name no longer ends the generated module's header comment.
- `@ng-native/web`: an image whose `referrerPolicy` is set is painted with an `<img>` that sends that policy, since a CSS background is fetched with the page's.
- `@ng-native/metro`: the dev server keeps a parked route history exactly as the app sent it, so a deeply nested body can no longer crash the server.
