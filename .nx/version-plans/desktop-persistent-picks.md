---
__default__: patch
---

On macOS files and folders the user picks or saves to stay reachable through `FileSystem` in later launches, through security-scoped bookmarks: a moved pick is found where it is now, and one that is gone is forgotten. Mac App Store builds are signed with the bookmarks entitlement this needs.
