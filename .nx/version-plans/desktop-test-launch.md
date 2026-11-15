---
__default__: patch
---

`vitest --project macos` now runs in the macOS desktop host. A test launch (`NGN_TESTS=1`) shows its windows without taking focus or a Dock icon, keeps its folders under `NGN_STATE_DIR`, its preferences in a defaults suite and its Keychain items under a prefix of its run, removes them as it ends, and answers open and save panels, permission prompts, Touch ID and alerts as cancelled. SIGTERM ends the host within three seconds, and `ng-native-desktop run` passes SIGTERM, SIGINT and SIGHUP to the host and exits with its status. The in-app test host now waits for the main window on macOS, and gives Vitest the worker state it reads as it loads on Hermes.
