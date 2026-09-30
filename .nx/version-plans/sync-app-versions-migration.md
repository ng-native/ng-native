---
__default__: patch
---

`nx migrate @ng-native/nx@latest` and `ng update @ng-native/schematics` now also move the `@ng-native/*` versions in each project's own `package.json`, through a `sync-app-versions` migration that runs on every upgrade from this release on.

In a workspace with package-manager workspaces, the app's `package.json` is where its `@ng-native/*` packages are installed from, and `nx migrate` rewrote only the root's. The migration keeps a `^` or `~` and leaves `workspace:` links and peer ranges alone. After `nx migrate --run-migrations`, it prints the install to run. `@ng-native/schematics` now declares an `ng-update` package group, so `ng update` moves the root's `@ng-native/*` packages together as well.
