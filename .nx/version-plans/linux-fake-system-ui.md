---
__default__: minor
---

`linuxLauncher()` now runs the host with a fake system UI by default, which needs `dbus-daemon` and `python3` with PyGObject where the host runs: a launch without them fails with status 70, so install them or pass `fakeSystemUi: false`.

The fake system UI is a session bus of the launch's own with a fake desktop portal for the FileChooser, OpenURI and Notification portals, so a request to one of those portals shows no dialog and waits for no one. The fake cancels a file chooser and opens a link unless a test writes an answer to `portals/answers.json` in the run's state folder, and it records every call to those portals in `portals/calls.jsonl`. `fakeSystemUi: false` runs against the session's own portals. With the fake, a container (the default off Linux) starts as root, whatever user its image names, adds a passwd entry for your user if the image has none, and runs the session as your user, as the bus requires. Where the host runs without a container of the launcher's, your user needs a passwd entry.
