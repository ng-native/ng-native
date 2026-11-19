---
__default__: patch
---

In-app tests run on Linux: `deviceTests({ platform: 'linux' })` from `@ng-native/testing/device/vitest` makes a `linux` project, so `vitest --project linux` runs the `*.device.ts` files inside the app on the GTK desktop host, which the pool starts itself through the new `linuxLauncher()`. It takes the host binary from its `host` option or `NGN_DESKTOP_HOST`.

Each launch loads the dev server's Linux bundle with a new state folder holding the XDG folders and `TMPDIR`, and an application id of its own. Its windows go to the display in use, or to a headless Weston (or, with `display: 'xvfb'`, an Xvfb) it starts where there is none. Off Linux the host runs in the AlmaLinux 9 image (`ngn-el9`), which reaches Vitest and Metro through forwarded ports. A lost host fails the file it was running with the end of the host's output.
