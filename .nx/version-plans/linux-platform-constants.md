---
__default__: patch
---

On Linux, `Platform.Version` and `Platform.constants.osVersion` are the distribution's os-release `VERSION_ID` ("24.04" on Ubuntu 24.04, empty on a rolling release such as Arch), in place of the kernel's release, so `OS_VERSION` from `@ng-native/device` is the distribution's major version (24), or null where it has none. `Platform.constants.systemName` is os-release's `NAME` ("Ubuntu", or "Linux" where it has none) in place of "Linux", and `interfaceIdiom` is `'desktop'` in place of `'mac'`. Inside a Flatpak they are the host's, not the runtime's.
