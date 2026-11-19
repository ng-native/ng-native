---
__default__: patch
---

`linuxLauncher()` runs the host with a fake system UI on Linux: a session bus of its own with a fake desktop portal for the FileChooser, OpenURI and Notification portals, so a request to one of those portals shows no dialog and waits for no one.

The fake cancels a file chooser and opens a link unless a test writes an answer to `portals/answers.json` in the run's state folder, and it records every call in `portals/calls.jsonl`. It needs `dbus-daemon` and `python3` with PyGObject where the host runs, and a launch without them fails; pass `fakeSystemUi: false` to run against the session's own portals. With the fake, a container (the default off Linux) starts as root and drops to your user once the image knows it, so that the bus accepts it.
