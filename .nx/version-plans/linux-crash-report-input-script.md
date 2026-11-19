---
__default__: patch
---

On the GTK desktop host on Linux, a crash writes `crash.txt`, naming the signal and the native stack, to the test launch's state folder or to `$XDG_STATE_HOME/<app id>/`, and prints it to standard error. A dev run or test launch plays `NGN_INPUT_SCRIPT` into its first window under X11 (Xvfb included) through XTest: the pointer steps, `key` and `type`.
