---
__default__: patch
---

`ngNative()` has Vitest process every installed package that lists `@angular/core` as a dependency or a peer, so a library such as `@tanstack/angular-query-experimental` shares the test's `@angular/core` and its `inject()` no longer fails with NG0203.

Vitest handed such a package to Node, which loaded a second instance of `@angular/core` for it, so the library's `inject()` saw none of the test's injection context and a partial-compiled one reached the runtime unlinked. A package that does not list `@angular/core` still goes in `ngNative({ inline })`. The plugin's patterns are now added only when `test.server.deps.inline` is not `true`, where they stopped the run with "ex.test is not a function".
