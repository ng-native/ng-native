---
__default__: patch
---

`@ng-native/router` keeps a back and forward history for each window, as `NavigationHistory`, for desktop OSes: one list per window spanning every change of its outlet, with forward building its page again from the URL. It moves through it for the OS's back and forward commands. `@ng-native/device` gives View > Back and Forward each OS's keys through `navigationShortcut`: Cmd-[ and Cmd-] on Apple's OSes, Alt-Left and Alt-Right elsewhere. `mount` from `@ng-native/platform` no longer fails when an environment initializer asks for `AppWindows`.
