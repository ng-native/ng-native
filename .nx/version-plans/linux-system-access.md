---
__default__: patch
---

On the GTK desktop host on Linux, `Shell` and `Linking` open a url, a file or its folder through the desktop's OpenURI portal, `KeepAwake` holds the session idle through the Inhibit portal, and `FileSystem.watch` reports changes; each falls back to GTK's own launcher or inhibitor where no portal answers. `FileSystem.paths.desktop` and `downloads` come from the XDG user-dirs file and are absent when it names none. `Processes.spawn` refuses `pkexec`, `busybox`, `flatpak-spawn`, `systemd-run`, `nsenter` and `chroot` on every OS, and inside a Flatpak looks for a bare program name in `/app/bin` first.
