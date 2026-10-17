---
__default__: patch
---

A component named `Map`, `WeakMap`, `Object`, `Reflect` or `JSON` renders and hot-reloads in a development build.

The code Metro adds to a component's file for hot reloading called those globals by name, and a class of the same name in the file is what it found, so the app failed as the file loaded, with `NG0203` for a component named `Map`.
