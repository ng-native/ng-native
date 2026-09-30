---
__default__: patch
---

`withAngularNative` now resolves `@babel/runtime` from the app's project first, so every helper import Expo's Babel preset writes reaches the Babel 7 runtime the app installed, not Babel 8's.

Under pnpm, a file in a package that does not declare `@babel/runtime` looks in
`node_modules/.pnpm/node_modules` before the workspace root. An install from before the root's
`@babel/runtime` 7 entry, in a workspace with `@angular-devkit/build-angular`, leaves Babel 8's
runtime there, and later installs keep it. When the project reaches no copy, the import resolves
from where it is written, as before.
