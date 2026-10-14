---
'__default__': patch
---

A module missing from the build, in Expo Go say, is reported when the service is used, not when it is injected, so every page that uses it says what to install. A service threw as it was made, which left Angular's record of it marked as being made, and every page after the first failed with NG0200, "Circular dependency": `<expo-map>`, `<expo-camera>`, `Haptics` and the rest. The service is made inert, with `available` false and `available()` resolving to false where it has one, and a call on it, or a read of a value only the module knows, throws the `MissingModuleError`. A player, a database, `assets()` and the splash screen still throw when they are called. `AppInfo`'s `version`, `build`, `id`, `name` and `device` are read when asked.
