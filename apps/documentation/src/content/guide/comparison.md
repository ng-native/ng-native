---
title: Angular Native compared
summary: Where this sits next to React Native, NativeScript, Ionic and Flutter, and why.
---

# Angular Native compared

React Native, NativeScript, Ionic and Flutter offer different rendering models, languages,
ecosystems and styling systems. The comparisons below include no benchmarks or speed claims.

## React Native

Angular Native uses React Native's Fabric renderer and Expo, replacing React, JSX, hooks and the
reconciler. Angular's `Renderer2` calls build `@ng-native/fabric`'s retained tree, which commits
like React Native's `ReactFabric`; see [Architecture](/guide/architecture). A `<view>` and React
Native's `<View>` become identical `UIView`s through the same C++ renderer.

`@ng-native/expo` wraps Expo modules as injectable services.
`registerExpoView(elementName, moduleName)` registers any Expo module's native view; see
[Using a module](/packages/expo/using-a-module). Expo's native implementation works unchanged,
regardless of the JavaScript renderer.

On the JavaScript side, templates replace JSX, signals replace hooks and `useState`, and dependency
injection replaces context and prop drilling. Zoneless change detection replaces re-renders on
every state update. `@ng-native/platform`'s `mount()` always enables zoneless mode, with no option
to add zone.js; see [Bootstrapping](/packages/platform/bootstrapping).

## NativeScript

NativeScript generates synchronous JavaScript bindings for 100% of platform APIs at compile time,
including marshalling of all data types ([NativeScript iOS Marshalling
docs](https://docs.nativescript.org/guide/ios-marshalling)). It calls Objective-C and Java APIs
directly, without React Native or per-API wrappers. Angular Native instead reuses the RN/Expo module
ecosystem. An arbitrary native SDK still needs a facade, as each `@ng-native/expo` module does.

`@nativescript/angular` is actively maintained: the [NativeScript/angular
monorepo](https://github.com/NativeScript/angular) tracks current Angular releases, including
22.0.0 (August 2026) for Angular 22. Its CSS engine emulates text-property inheritance, solving the
same problem as [CSS on native](/packages/fabric/css-engine). NativeScript targets iOS, Android
and visionOS, with no browser counterpart to [`@ng-native/web`](/packages/web).

## Ionic and Capacitor

A Capacitor app runs in the platform's WebView: `WKWebView` on iOS, `android.webkit.WebView` on
Android. A JavaScript bridge exposes native plugin methods on `window.Capacitor` ([How Capacitor
works](https://ionic.io/blog/how-capacitor-works-2)). Its `ion-button` and `ion-list` web components
render as DOM, styled with CSS and shadow DOM. Angular is one of Ionic's three first-class framework
targets, with an official, mature integration. Angular knowledge carries over, but `ion-*`
components, browser CSS and DOM API calls do not. Angular Native's `<view>` and `<text>` render as
`UIView`s and Android `View`s; see [Architecture](/guide/architecture).

Ionic is closer to Angular Native's web target: `@ng-native/web` runs in a browser, and both are
accessible by URL. Capacitor's UI always runs in a WebView. `@ng-native/web`'s `BrowserEngine`
instead implements the same interface as Fabric; see [Native and web](/guide/native-and-web).
A component rendered as DOM on this site renders as a `UIView` on a device.

## Flutter

Flutter bypasses system UI widgets and paints its own onto a surface through Skia or Impeller.
Impeller is the default on iOS and Android (API 29+) from release 3.27 ([Impeller
docs](https://docs.flutter.dev/perf/impeller)). It creates no `UIView`s or Android `View`s. This
allows pixel-identical rendering across platforms, with its own animation and layout systems.
Flutter reimplements controls and their look-and-feel updates, and exposes accessibility through
its semantics tree rather than native views.

Angular Native's `<switch>` uses the platform's switch control and current OS styling. Flutter
uses Dart, `pub.dev` and its own build system; it shares no Angular code or npm packages with
Angular Native.

## Styling

React Native has no CSS engine; NativeWind compiles Tailwind into style objects. Ionic uses DOM
CSS, while Flutter styles widgets without a cascade. Angular Native compiles component `styles`
with lightningcss and uses `@ng-native/fabric` for runtime matching, inheritance and resolution;
see [CSS on native](/packages/fabric/css-engine). `@ng-native/tailwind` uses this cascade, so
`class="flex-1 bg-blue-500 p-4"` on a `<view>` matches directly, without an interop layer.

## Maturity

Angular Native is an alpha. It implements a retained tree with incremental commits, routing, Signal
Forms, CSS, Expo and React Native facades, and Reanimated worklet animations. Release builds
(`expo run:ios --configuration Release` / `expo run:android --variant
release`) run on the iOS simulator and Android emulator, producing Hermes bytecode with no Angular
compiler and `ngDevMode` false.

Many platform facades have unit tests and typechecks but no hardware verification. Simulator checks
also cover CSS behavior beyond unit tests; see the canary's verify screen and
[CSS on native](/packages/fabric/css-engine). Treat this as a working prototype. See
[Known limitations](/guide/limitations) for specific gaps.

## When to choose which

- Choose Angular Native for an existing Angular app or a team wanting Angular templates, signals
  and DI with native views and Expo modules.
- Choose React Native for a team invested in React, where Fabric's ecosystem is largest.
- Choose NativeScript for direct access to an unwrapped native SDK, when that matters more than
  React Native plugin reuse.
- Choose Ionic for a web app that needs installation, or a web team avoiding native build tooling.
- Choose Flutter when pixel-identical rendering matters more than native controls, or a new team
  has no investment in web, Angular or React ecosystems.
