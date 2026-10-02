---
title: Metro
summary: The Babel transformer that compiles Angular ahead of time and turns CSS into a rule set.
---

# Metro

`@ng-native/metro` is the build-time half of this framework. It is a Metro config preset plus
a Babel transformer: the piece that compiles your Angular components ahead of time, turns each
component's `styles` into the rule set [Fabric](/packages/fabric/css-engine) reads at runtime,
links whatever Angular libraries you installed from npm, and wires up hot reload without an Angular
dev server in the loop. None of it is optional - without it, Metro has no idea what to do with a
`.ts` file that has `@Component` in it, and cannot bundle one at all.

Reach for this package once, in `metro.config.js`, and otherwise leave it alone: it runs on every
file in your app automatically once wired in.

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

One preset, no options in the common case, because every part of it is built to fail quietly on its
own if you leave it out - which is exactly why it exists as a preset rather than a page of manual
wiring.

## What it does, roughly

`withAngularNative` points Metro's transformer at a compiler that AOT-compiles every
`@Component`/`@Directive`/`@Pipe`/`@Injectable`/`@NgModule`/`@Service` file it finds, compiles each
component's CSS with lightningcss into the rule set Fabric matches at runtime, and installs three
polyfills every app needs before `@angular/core` first runs. It also patches Metro's own cache key
and dev-server watching so an edit to the compiler itself is never served stale, and embeds a hot
-reload path that can patch a live component's template without a full bundle reload.

A capitalized element name - `<Card>` instead of `<card>` - is a hard build failure here rather
than a blank screen, because Angular itself would otherwise compile it to an empty template with no
error at all.

In a monorepo where the framework packages live outside your app's own `node_modules`, pass
`{ workspaceRoot }` to `withAngularNative` - it adds the workspace root to `watchFolders` and both
`node_modules` directories to `resolver.nodeModulesPaths`, which is what lets Metro see a workspace
package's source at all.

[Configuration](/packages/metro/configuration) covers `withAngularNative`'s options, what happens
to a component file in detail, how component CSS is compiled and what the build warns about,
and how the hot-reload path decides between patching a template and falling back to a
full reload. Wiring in Tailwind on top of this preset is [its own
setup](/packages/tailwind).
