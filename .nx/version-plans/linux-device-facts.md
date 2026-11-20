---
__default__: patch
---

On the GTK desktop host on Linux, `AppInfo`, `Locale` and `Crypto` have a source of their own. `AppInfo` reads a package's version, build number, id and name from its `metadata.json`, which now carries the build number as `CFBundleVersion`, and its device facts from the firmware (the maker as the brand), the distribution's `os-release` and the kernel. `Locale` lists the languages `LANGUAGE` and the messages locale name, with the separators, currency and measurement system of the locales the formats are set to, and the calendar's time zone, clock and first weekday; it no longer answers English in the system's region. `Crypto` digests with GLib (SHA-1, SHA-256, SHA-384, SHA-512 and MD5; MD2 and MD4 answer nothing) and takes random bytes from the kernel. On macOS, Device's brand is still Apple; on another OS it is no longer Apple but the machine's maker.
