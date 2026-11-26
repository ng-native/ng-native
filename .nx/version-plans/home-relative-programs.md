---
__default__: patch
---

A desktop app's spawn capability can declare a program in the user's home folder, such as `{ "program": "~/.local/bin/claude" }`. It is pinned against the account's home folder once, at startup, for tools that install there rather than system-wide.
