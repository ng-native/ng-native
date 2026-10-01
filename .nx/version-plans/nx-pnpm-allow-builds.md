---
__default__: patch
---

`nx add @ng-native/nx` and the app generator no longer stop at the install with `ERR_PNPM_IGNORED_BUILDS` on pnpm 11, because they decline the two install scripts `@nx/expo` brings in, `@parcel/watcher` and `unrs-resolver`, in `pnpm-workspace.yaml`.

They go under `allowBuilds` as `false`: both packages ship prebuilt binaries, and their scripts only build from source. A decision the workspace already made stays, and the placeholder pnpm writes after refusing an install is settled. The file keeps its comments and layout. An `allowBuilds` written as a flow mapping is left as it is, with a warning naming the two packages to decide. A workspace with a pnpm lockfile and no `pnpm-workspace.yaml` gets one that holds only this setting. Workspaces on npm, yarn or bun are unchanged.
