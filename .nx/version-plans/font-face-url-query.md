---
'__default__': patch
---

A `@font-face` url with a query or a fragment, `url('./Inter.ttf?v=2')`, bundles the file it names, and a remote or `data:` url is dropped with a warning that names the face. Each was passed to the bundler as it was written, which failed to resolve it.

A face that lists a remote url before a file in the app, `src: url(https://x.com/a.ttf), url(./a.ttf)`, bundles the file in the app instead of refusing the face.
