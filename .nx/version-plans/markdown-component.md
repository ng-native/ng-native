---
__default__: minor
---

`<markdown>`, from the new `@ng-native/components/markdown` entry point, draws a Markdown document as native text and views: headings, paragraphs with nested emphasis, code spans and links, quotes, ordered, unordered and task lists, code blocks in a horizontal scroll view, rules, tables and images. It parses with `marked`, a new optional peer dependency the main entry point never imports. `source` takes the Markdown and `tokens` takes tokens lexed already; `classes` replaces an element's default `md-*` class; `(linkPress)` reports a pressed link, and an absolute one is opened with `DeepLinks.open` unless the handler calls `preventDefault()`. Raw HTML is drawn as text, links are followed only to `http`, `https`, `mailto`, `tel` and relative targets, and images load only over `http` and `https`.
