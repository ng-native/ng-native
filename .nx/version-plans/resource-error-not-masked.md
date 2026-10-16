---
__default__: patch
---

When a component's template does not compile, the error for its `templateUrl` or `styleUrl` file now names the component and says its template did not compile, instead of a Babel `Unexpected token` at the top of the stylesheet or template file.

The Metro transformer retries a file whose Angular stage failed through Babel, so a TypeScript mistake is reported at its line and column. A stylesheet or a template file is not JavaScript, so Babel always failed on it, and its syntax error replaced the component's. Only a JavaScript or TypeScript file is retried now. A dev server may report the resource file's failure before the component's own, so this was the error a developer could see first.
