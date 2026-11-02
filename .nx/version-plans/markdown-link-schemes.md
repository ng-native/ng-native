---
__default__: patch
---

`<markdown>` can draw links in the app's own schemes, such as `myapp:item/42`, as links reported through `(linkPress)`: list them in a new `[linkSchemes]` input, or for every `<markdown>` with `provideMarkdownLinkSchemes('myapp')` from `@ng-native/components/markdown`.

A listed scheme is never opened by `<markdown>`, even when no handler calls `preventDefault()`, so the app routes it. The input replaces the provider's list when it is set, an empty one included. Schemes are matched without regard to case. A scheme that is not listed is still drawn as the link's text, `javascript:` among them, and `http`, `https`, `mailto` and `tel` are opened on press as before. Changing the list draws the document again, a streaming one too.
