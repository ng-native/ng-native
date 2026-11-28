---
__default__: patch
---

`@ng-native/web-compat` now sets a library's inline boxes among the words around them, as a browser does: `If you use none, links would <button tuiLink>inherit text color</button> in tandem` is one paragraph that wraps past the link, where each run of words was a line of its own and the link a line of its own between them. The box sits on the paragraph's baseline, a link's icon and its words stay on one line, and a `<code>` or `<b>` beside it is a span of the paragraph. That holds in a `<p>` and for words written straight into a block beside a box. A component with no selector in a directory given as `sources`, as Taiga UI's examples are, is hosted by an inline `ng-component` as in a browser, where it was a native view.

A `::before` or `::after` box is inline until a rule gives it a display, as a browser's is, and a span that is an inline-block clipping what it holds, a line cut short with an ellipsis, is a box among the words.
