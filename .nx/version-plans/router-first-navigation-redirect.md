---
__default__: patch
---

A root guard's redirect at launch, such as one that sends the app to sign in, now lands before anything that arrives while it is still running: a screen pushed or presented, a deep link (with or without `withLinkParent`), or a page restored after a reload in development. Before, each of these cancelled the redirect and opened alone, past the guard.
