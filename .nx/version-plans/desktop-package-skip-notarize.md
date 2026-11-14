---
__default__: patch
---

`ng-native-desktop package --format dmg --skip-notarize` makes a disk image without notarising it, signed with `NGN_SIGN_IDENTITY` or ad hoc, for testing on the Mac that built it. Without the flag, a `dmg` missing its credentials says that the flag exists.
