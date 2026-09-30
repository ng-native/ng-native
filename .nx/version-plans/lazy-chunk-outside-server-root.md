---
__default__: patch
---

The Metro preset now serves a lazy route that imports from a library outside the app's directory, which failed on the dev server with "Could not load bundle" in an integrated Nx workspace.

Expo addresses a lazy chunk by its path from Metro's server root. The server root is the app's own directory wherever the app is not a package-manager workspace, so a chunk from a library beside the app asked Metro for a file inside the app. The preset's `rewriteRequestUrl` now finds such a chunk above the server root and passes Metro its real path. It runs after any `rewriteRequestUrl` already in the config, Expo's included. Release bundles were never affected.
