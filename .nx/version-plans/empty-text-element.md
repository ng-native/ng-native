---
'__default__': patch
---

One of HTML's text elements with nothing in it is a view, where it was a paragraph with no text.

`<span class="dot"></span>` styled as an 8 by 8 box was committed as an empty paragraph, which is not sized or painted as the box it is styled as. An empty `span`, `p`, `label` or other text element is now a view, as it is where it holds an element, and becomes a paragraph when it is given text. `<text>` is a paragraph whatever it holds.
