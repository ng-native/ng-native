---
title: Metro
summary: The Babel transformer that compiles Angular ahead of time and turns CSS into a rule set.
---

# Metro

`@ng-native/metro` is the build-time half of this framework. It is a Metro config preset plus
a Babel transformer: the piece that compiles your Angular components ahead of time, turns each
component's `styles` into the rule set [Fabric](/packages/fabric/css-engine) reads at runtime,
links whatever Angular libraries you installed from npm, and wires up hot reload without an Angular
dev server in the loop. Without it Metro cannot bundle an Angular component. It is wired in once, in
`metro.config.js`.

## The smallest setup

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');

module.exports = withAngularNative(getDefaultConfig(__dirname));
```

```json
// app.json
{
  "expo": {
    "plugins": ["@ng-native/metro"]
  }
}
```

The config plugin adopts the UIKit scene life cycle in the `AppDelegate.swift` that `expo prebuild`
writes, which an app built with the iOS 27 SDK needs to launch at all. It also hands the status bar
to view controllers: that SDK ignores the app-wide setters React Native's status bar module calls,
so without it [`StatusBar`](/packages/device/status-bar) changes nothing on iOS 27.

It takes two options, each off by default. `ios.multipleWindows` says in `Info.plist` that the app
supports several scenes, which [`AppWindows`](/packages/device/app-windows) needs to open windows
on an iPad, and declares the activity it asks for each one with. iPadOS then also offers New Window
for the app.

`android.layoutAnimations` turns on React Native's
`enableLayoutAnimationsOnAndroid` feature flag in the `MainApplication.kt` that `expo prebuild`
writes, keeping every other flag as the app's React Native release level sets it:

```json
// app.json
{
  "expo": {
    "plugins": [["@ng-native/metro", { "android": { "layoutAnimations": true } }]]
  }
}
```

React Native ships that flag off, and with it off
[`LayoutAnimation`](/packages/device/layout-animation) makes its change on Android without
animating it. With the option on, a prebuild fails when `MainApplication` is not the Kotlin class
Expo's template writes, or already overrides the flag some other way, and says so. Without it the
plugin leaves the Android project as `expo prebuild` wrote it. A prebuild after the option is
removed writes `MainApplication.kt` again without the override.

## What it does

[Configuration](/packages/metro/configuration) covers what `withAngularNative` sets up, its
options (`workspaceRoot` for a monorepo among them), what happens to a component file, how
component CSS is compiled and how hot reload works. Two more things it does:

A `.md` file is a module too: `import post from './post.md'` is `{ attributes, content, tokens }`,
its front matter parsed and its Markdown lexed by `marked` as the app is bundled, for
[`<markdown [tokens]>`](/packages/components/markdown#importing-md-files). `marked` is an optional
peer, needed only when the app has a `.md` file.

An app with `@nativescript/react-native` installed and no Babel config of its own gets one with the
worklets plugin's `strictGlobal` set, which a worklet naming a native class needs; see
[NativeScript](/packages/nativescript#the-babel-config).

Wiring in Tailwind on top of this preset is [its own setup](/packages/tailwind).
