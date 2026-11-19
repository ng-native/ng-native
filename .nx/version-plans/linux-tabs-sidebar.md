---
__default__: patch
---

On Linux a native tabs outlet draws as it does on macOS: a split view whose sidebar lists the tabs, with their badges, and whose content shows the chosen tab's screen, under the tab's title when its screen sets none. A sidebar's list on Linux now moves its selection in place when only the selection changed, where it built its rows again and could miss the next click.
