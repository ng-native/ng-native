---
__default__: patch
---

`nx add @ng-native/nx` and `nx g @ng-native/nx:app` now write exact versions in a workspace that saves them, reading pnpm's, npm's, Yarn's and Bun's settings for it: the newest version each range allows, as `pnpm add` would save it, or the lowest when the registry cannot be reached. An app in a package-manager workspace takes the root's version of a package the root already pins, so its Angular and TypeScript do not drift from the rest of the workspace.
