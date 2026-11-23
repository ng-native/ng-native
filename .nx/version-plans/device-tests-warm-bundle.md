---
__default__: patch
---

The device test runner's iOS and Android launchers now have Metro bundle the app while the simulator or emulator boots and the app installs, and launch the app once that bundle is ready, waiting at most five minutes for it. The app's own request is then answered from the bundle Metro keeps. Before, Metro started bundling only when the app asked, which on a CI runner with no Metro cache could take minutes after launch.
