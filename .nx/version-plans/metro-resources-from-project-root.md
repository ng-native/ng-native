---
'__default__': patch
---

A `templateUrl` or `styleUrl` is read from the project when Metro is started from another directory, as `npx expo export apps/mobile` starts it. It was read from the directory the command ran in, and the build failed with a file not found.
