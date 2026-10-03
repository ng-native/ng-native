---
__default__: patch
---

`render()` with a template string no longer logs `NG0303` for each native prop a component in it binds on its own host, the ones `PressBehavior` binds included.

The template is compiled with `NO_ERRORS_SCHEMA`, as an app's templates have no such check at run time. A property a test's template misspells on a component is therefore not reported there either.
