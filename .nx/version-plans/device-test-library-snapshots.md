---
__default__: patch
---

Device tests in a library outside the app read and write their snapshot files, which the pool now allows anywhere in the workspace Metro serves (`serverRoot`) rather than only in the app's project.

A `.snap` file is still refused inside `node_modules`, or where a symlink on its path leads outside that directory.
