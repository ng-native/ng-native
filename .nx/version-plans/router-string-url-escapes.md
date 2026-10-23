---
__default__: patch
---

A url string given to `NativeNavigation.push()`, `replace()`, `present()` or `reset()` now has its path parsed as `navigateByUrl()` and `popTo()` parse it: `push('/user/a%20b')` opens `/user/a%20b` with the parameter `a b`, `push('/user/1;tab=posts')` gives the segment `1` the matrix parameter `tab`, and a named outlet such as `(aux:b)` reaches its outlet. Before, the path went to `navigate()` as segment text, so its escapes were escaped again (`/user/a%2520b`, the parameter `a%20b`), and a `;` or an outlet's brackets became part of a segment. This includes a page of another tab given to `present()`. A deep link that arrives while the app is running is pushed this way without `withLinkParent`, so it now opens with the same parameters as when the app launches on it, and a `popTo()` with the same string now finds the screen.
