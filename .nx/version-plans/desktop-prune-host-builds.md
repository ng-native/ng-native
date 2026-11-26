---
__default__: patch
---

A desktop build now removes the host builds in the build cache whose sources are gone: one made for an install of `@ng-native/desktop` that an upgrade, a patch or a removed project or worktree has replaced, or one made for an app that no longer exists. Each was a full build, and before this nothing removed them.
