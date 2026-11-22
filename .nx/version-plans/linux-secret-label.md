---
__default__: patch
---

On Linux, a SecureStore item stored from now on is labelled in the keyring with the app's id once, `<app id> <key>` for the default service, rather than the id twice.

The label is what Seahorse and KWallet list. An item stored before keeps its label until it is stored again.
