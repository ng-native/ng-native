---
__default__: patch
---

`@ng-native/web-compat` now collapses white space in HTML's text elements as a browser does: a value written over several lines, JSON in a `<code>` say, is one line of words, where its line breaks were drawn. A `<text>` keeps its line breaks, as React Native's does, and so does a `<pre>` and a text element in one, `<pre><code>`, as a browser keeps them. An empty inline box at the start of a line, a `::before` with no content, puts nothing there, so the space after it goes as at any line's start.
