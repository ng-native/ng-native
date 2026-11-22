---
__default__: patch
---

On Linux, a SecureStore item stored from now on in a Secret Service keyring, such as GNOME Keyring or KWallet's, is labelled with the app's id once, `<app id> <key>` for the default service, rather than the id twice.

The label is what Seahorse and KWallet list. An item stored before keeps its label, and storing it again may not change it: KWallet keeps an existing item's label. Inside a Flatpak using libsecret's file backend, items are kept in the app's own keyring, which those apps do not list.
