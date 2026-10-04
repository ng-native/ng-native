---
title: Markdown without a parser on the device
description: Metro lexes every .md file as the app is bundled, so a post is data by the time it ships.
date: 2026-10-02
author: The Angular Native team
---

This post is a file in `src/content`. Metro read its front matter and lexed its Markdown with
`marked` while it bundled the app, so the device receives **tokens**, not text to parse.

> `injectContent()` reads the `slug` route parameter and finds the file, as it does in Analog.

```ts
const post = toSignal(injectContent<PostAttributes>());
```

| On the web          | On native             |
| ------------------- | --------------------- |
| `<analog-markdown>` | `<markdown [tokens]>` |
| HTML, then the DOM  | Native text and views |
