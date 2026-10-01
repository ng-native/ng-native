---
__default__: patch
---

A new package, `@ng-native/migrate`, holds the migrations that update an app to a new release, and `npx @ng-native/migrate@latest` runs them in an app made from the template, which has neither `nx migrate` nor `ng update`.

`nx migrate @ng-native/nx` and `ng update @ng-native/schematics` run the same migrations from it, so each is written once. `sync-app-versions` now moves the `@ng-native/*` versions in every `package.json` in the workspace, outside `node_modules` and hidden directories, rather than only those of the projects Nx or `angular.json` lists. See [Updating an app](https://ng-native.com/guide/updating).
