---
__default__: patch
---

Every `@ng-native/expo` service now reports a module whose native half is not in the build with a `MissingModuleError`, where Metro showed a fatal error from the package's JavaScript before.

On iOS and Android, each service asks Expo for its package's native module before it evaluates the package, as `expoFonts()` did alone. Most Expo packages throw while they are being evaluated when their native module is missing, as in an Expo Go or a development build without it, and Metro reports that as fatal when the load is not inside another module's. The web evaluates the package as before, since a package registers its module there only once it is evaluated. `expo-camera` and `expo-maps` reach their native modules directly and are unchanged.
