## 0.1.1 (2026-09-29)

### 🩹 Fixes

- An app from `ng add @ng-native/schematics` or `nx g @ng-native/nx:app` starts without warnings. ([#5](https://github.com/ng-native/ng-native/pull/5))
  Its `app.json` sets the router root, as the template's does, so Expo no longer prints "Using
  src/app as the root directory for Expo Router". In Nx, the app's `start` target runs `expo start`
  itself rather than through `@nx/expo:start`, whose deprecation notice Nx printed on every
  `nx start`, and `nx add @ng-native/nx` adds Babel 7's `@babel/runtime` at the root, so Metro no
  longer warns about `@babel/runtime/regenerator` in an `@nx/angular` workspace. For an app made
  before this release, add `"extra": { "router": { "root": "src/app" } }` to its `app.json`; in Nx,
  also add a `start` target running `expo start` in the app's directory and `@babel/runtime@^7.20.0`
  to the root `devDependencies`.

- The template targets iOS and Android only. ([#5](https://github.com/ng-native/ng-native/pull/5))
  Its `app.json` names both as its `platforms`, and the web favicon, its `web` settings and
  `web-build/` in `.gitignore` are gone. The Angular CLI and Nx generators name the same platforms.
  Angular Native components render in a browser through `@ng-native/web`, which is set up
  separately.

### ❤️ Thank You

- Ashley Hunter

## 0.1.0 (2026-09-29)

### 🚀 Features

- The first public release: Angular components as real native iOS and Android views, in an Expo app. ([8803fb6](https://github.com/ng-native/ng-native/commit/8803fb6))
  Angular Native is built on Expo and React Native's Fabric renderer, so an app is created, run, hot
  reloaded, built and shipped with the Expo tooling you already know, and Expo's modules - the photo
  picker, location, Face ID and fingerprint, sign-in through the system browser, pictures from the
  camera view, notifications, secure storage and the rest - are available as Angular services and
  directives. Alongside that: a CSS engine that compiles stylesheets and Tailwind at build time, a
  native stack and tab router over `@angular/router`, Signal Forms support, device services, and a
  testing library that runs components in Node against a fake Fabric.

### ❤️ Thank You

- Ashley Hunter
