---
__default__: patch
---

On macOS files and folders the user picks or saves to stay reachable through `FileSystem` in later launches, through security-scoped bookmarks: a moved pick is reachable at the path it has now, though a uri saved before the move still names the old path, and one that is gone is forgotten. Mac App Store builds are signed with the bookmarks entitlement this needs.
