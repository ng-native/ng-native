---
__default__: patch
---

A `SecureStorage` signal whose first read fails, such as a keychain the app has no entitlement for,
keeps its default and reports the failure on `error`, as a failed asynchronous read already did.
It used to throw from `signal()`, so the component asking for it was never created and its screen
rendered blank.
