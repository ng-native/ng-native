---
__default__: patch
---

An app from `ng add @ng-native/schematics` or `nx g @ng-native/nx:app` starts without warnings.
Its `app.json` sets the router root, as the template's does, so Expo no longer prints "Using
src/app as the root directory for Expo Router". In Nx, the app's `start` target runs `expo start`
itself rather than through `@nx/expo:start`, whose deprecation notice Nx printed on every
`nx start`, and `nx add @ng-native/nx` adds Babel 7's `@babel/runtime` at the root, so Metro no
longer warns about `@babel/runtime/regenerator` in an `@nx/angular` workspace. For an app made
before this release, add `"extra": { "router": { "root": "src/app" } }` to its `app.json`; in Nx,
also add a `start` target running `expo start` in the app's directory and `@babel/runtime@^7.20.0`
to the root `devDependencies`.
