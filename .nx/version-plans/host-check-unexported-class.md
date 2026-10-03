---
__default__: patch
---

The build no longer fails with "host cannot be read at build time" on a component that has no `host`, when it follows another component in the same file and neither class is exported, as the components in a test file are.

The check read the decorator of the component before it. A class that is not exported now has its own `host` and `styles` checked, where the first one in a file was passed over.
