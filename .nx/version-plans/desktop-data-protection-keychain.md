---
__default__: patch
---

On macOS `SecureStore` keeps its items in the Data Protection keychain when the app is signed with a Team ID and an application identifier, as a Mac App Store build is, and moves an item an earlier build kept in the file keychain over the first time it is read. Other builds keep using the file keychain.
