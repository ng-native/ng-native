---
__default__: patch
---

Text written straight inside a `<div>` or another HTML layout element no longer logs "`<text>` is used in a template that does not import Text". The paragraph is one the engine adds for the text, not a `<text>` the template wrote.
