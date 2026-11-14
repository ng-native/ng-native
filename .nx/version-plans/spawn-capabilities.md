---
__default__: patch
---

`@ng-native/device` adds the rules for a desktop app's declared capabilities, and the `@ng-native/desktop` plugin options they are declared in (`documentTypes`, `capabilities.spawn`, `capabilities.env`, `capabilities.paths` and `deny`), importable in Node from `@ng-native/device/desktop-options` for a config plugin. A spawn capability is an absolute program or a bare name resolved on `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/opt/homebrew/bin` and `/usr/local/bin`, with literal arguments and anchored `{name:regex}` placeholders (`{name:regex}...` for zero or more); a placeholder takes no argument starting with `-` unless its pattern starts with one, and shells, `env`, programs that run their arguments as a command, and `.bat` and `.cmd` files are refused. `validateDesktopOptions` names where each problem is, unknown keys included.
