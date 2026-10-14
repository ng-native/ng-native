---
'__default__': patch
---

`nx g @ng-native/nx:tailwind` puts Tailwind into a `src/styles.css` the app already has. It pointed Metro at the file and left it as it was, so every Tailwind class drew unstyled on a build that passed.
