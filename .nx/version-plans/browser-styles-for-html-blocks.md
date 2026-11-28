---
__default__: patch
---

`@ng-native/web-compat` now gives a library's paragraphs, headings, lists, `<blockquote>`, `<figure>`, `<pre>`, `<hr>` and `<fieldset>` the margins, heading sizes and weights a browser's own stylesheet gives them, a list's indent on the side its text starts and a `<pre>` the platform's monospace font, under every rule an app or a library writes. Taiga UI's examples space their text by them, and were drawn with no space between paragraphs. `@ng-native/fabric` exports these rules as `BROWSER_STYLES` and applies them to an element with `Engine.giveBrowserStyles`.
