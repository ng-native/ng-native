---
__default__: patch
---

The device test runner's iOS and Android launchers now ask Metro for the app's bundle while the simulator or emulator boots and the app installs, and launch the app once that request ends.

The launchers wait at most five minutes for the bundle, and launch the app anyway when the request fails or runs out of time; the app's own request then builds the bundle, or reports why it cannot. When the request succeeds, the app's own request is answered from the bundle Metro kept. Before, Metro started bundling only when the app asked, which on a CI runner with no Metro cache could take minutes after launch.
