---
title: A tour of the formatting
summary: Headings, emphasis, lists, quotes, code, tables and images.
---

# Formatting

## Inline

**Bold**, _italic_, **_both_**, ~~struck through~~ and `inline code` all wrap as one paragraph,
with [a link back to the welcome note](/notes/welcome) in the middle of it.

## Lists

1. Ordered items count themselves
2. And nest:
   - an unordered item
   - [x] a task that is done
   - [ ] a task that is not

## Quote

> A quote is set off by a rule down its side, and can hold **emphasis** too.

## Code

```ts
import welcome from './welcome.md';

const title = welcome.attributes.title;
```

## Table

| Element | Class           | Drawn as  |
| ------- | --------------- | --------- |
| Heading | `md-h1`         | `<text>`  |
| Quote   | `md-blockquote` | `<view>`  |
| Image   | `md-img`        | `<image>` |

---

## Image

![The Angular logo](https://github.com/angular.png)

<b>Raw HTML</b> is drawn as the text it is written as.
