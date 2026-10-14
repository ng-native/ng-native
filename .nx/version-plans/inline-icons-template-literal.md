---
'__default__': patch
---

An `@ng-icons` import shown as a code sample inside a template literal is left as text. It was rewritten as the build rewrites a real import, which broke the string and failed the build.
