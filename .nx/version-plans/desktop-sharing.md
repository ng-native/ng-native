---
__default__: patch
---

On macOS `Sharing.share()` shows AppKit's share picker through the desktop host's `NgNativeSharing`: a message as text, and a url as a link or, for a `file:` uri or a path, as the file. `Sharing.available()` is true on macOS, where it was false.
