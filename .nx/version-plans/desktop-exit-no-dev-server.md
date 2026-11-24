---
__default__: patch
---

A desktop host that cannot load its bundle, as on macOS with the dev server not yet up, now exits with status 1 after its message. Before, the macOS host then aborted with "mutex lock failed", which could leave a crash report.
