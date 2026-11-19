---
__default__: patch
---

`linuxLauncher()` runs the host in the image `NGN_LINUX_IMAGE` names when it runs one (off Linux, with no `container` option), so `NGN_LINUX_IMAGE=ngn-fedora` runs in the Fedora variant of the host's build image, which has a newer GTK and libadwaita, instead of the AlmaLinux 9 `ngn-el9` it runs in by default.

An empty or malformed `NGN_LINUX_IMAGE` fails the launch rather than running in the default image. A `container` option still wins.
