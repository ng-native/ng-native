---
__default__: patch
---

`Processes.spawn(program, args, { cwd, env })` runs a program the app declares in `capabilities.spawn` on macOS, never through a shell, with its standard output, standard error, standard input, exit and `kill`; an undeclared call throws `UndeclaredCapabilityError`, and only the variables `capabilities.env` declares reach the program. A new `Shell` service in `@ng-native/device` has `openExternal`, `openPath` and `showItemInFolder` on macOS. Both resolve null or false on iOS, Android and the web, where they are absent.
