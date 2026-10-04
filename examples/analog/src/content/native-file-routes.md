---
title: File routes on a native stack
description: How Analog's pages become screens with a native header and a back swipe.
date: 2026-09-12
author: The Angular Native team
---

Every file in `src/app/pages` is a screen. `createRoutes` from `@analogjs/router` turns the files
into routes, exactly as on the web, and `provideNativeRouter` puts each one on a **native stack**.

## What you get

- A real navigation bar, with the title from `routeMeta`
- The system back swipe on iOS and the back button on Android
- Layouts as stacks of their own, presented as sheets

Read the [other post](/blog/markdown-without-a-parser) to see how this one is drawn.
