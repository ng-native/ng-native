---
'__default__': patch
---

`nx g @ng-native/nx:tailwind` keeps a leading `@charset` first when it adds Tailwind to an existing stylesheet, adds it to one that only mentions Tailwind in a comment, and writes a Tailwind 3 config that loads for a library in a directory named `require`, `module` or `exports`.
