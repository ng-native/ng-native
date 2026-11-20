---
__default__: patch
---

On the GTK desktop host on Linux, `SecureStore` keeps its items in the Secret Service through libsecret (the Secret portal inside a Flatpak), and is absent when no Secret Service runs or can be started; the host now needs libsecret 0.20 or later.
