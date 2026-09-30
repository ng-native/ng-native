---
__default__: patch
---

An `@font-face` in the Tailwind entry now bundles its font file. The generated `.angular-native/app.tailwind.js` held the `url()` as a plain path, so Metro never shipped the file and `loadFonts()` had nothing to register; it is now a `require`, re-pointed from the entry's folder to the generated module's.
