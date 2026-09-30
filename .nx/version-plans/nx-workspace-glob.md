---
__default__: patch
---

`nx g @ng-native/nx:app` now adds the app's own directory to the workspace's packages, not a glob of its parent, when another directory there already has a `package.json`. A workspace that lists its apps one by one keeps doing so, and no other package joins the workspace unasked.
