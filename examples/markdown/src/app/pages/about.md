---
title: About this reader
---

# Routed by its file name

This page is `src/app/pages/about.md`. `fileRoutes` from `@ng-native/router` made it the screen at
`/about`, titled by its front matter, and drew it with the app's `MarkdownPage` component.

Every other screen is a file in `src/app/pages` too: `index.page.ts` is the library, and
`notes/[slug].page.ts` is [a note](/notes/welcome), with its slug as an input.
