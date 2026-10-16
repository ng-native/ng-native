---
__default__: patch
---

A dev bundle for iOS or Android builds, and an edit hot-swaps, when a component whose `styleUrl` or `templateUrl` is shared has an aliased `@if (x; as y)` or a `@switch` in its template.

`compileForHmrSync` reports a warning about these blocks beside an update that is complete, and the Metro transform took any report for a template that did not compile. A stylesheet or template module then threw, which failed the dev bundle with a syntax error on that file, and an edit to an inline template with these blocks reloaded the app instead of swapping. Only an error from the compiler stops a hot update now; a template that does not compile still fails the build, naming the component.
