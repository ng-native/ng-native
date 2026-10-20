---
__default__: patch
---

The Metro transformer wraps the Babel transformer of the app's own `expo`, where in a pnpm workspace it could wrap a newer SDK's `@expo/metro-config` that pnpm had installed beside `@ng-native/metro`.

pnpm resolves `@ng-native/metro`'s optional `@expo/metro-config` peer to the newest release, so an SDK 57 app in an Nx workspace was transformed by SDK 58's transformer. The copy beside `@ng-native/metro` is now used only when `expo` cannot be found from Metro's working directory, and an `expo` that cannot be read is reported rather than passed over.
