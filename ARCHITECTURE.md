# Architecture

React Native's renderer is not coupled to React. Fabric exposes a JSI-bound mutation API on
`global.nativeFabricUIManager`, and React's reconciler is one client of it. Angular is another,
through `Renderer2` and `RendererFactory2`. Everything here follows from that one seam, and
`react-native` and `expo` stay unmodified dependencies: nothing is forked.

```
Angular component
      ↓  Renderer2 (createElement, appendChild, setProperty, listen, ...)
@ng-native/platform
      ↓  the engine's mutation API
@ng-native/fabric          retained tree, clone-on-write commit, events, CSS runtime
      ↓  global.nativeFabricUIManager
Fabric C++ / JSI / Yoga / iOS and Android host views
```

The mismatch the engine exists to solve is that Angular mutates and Fabric is persistent. A
committed node is never edited; it is cloned with new props or children, and a changed leaf forces
every ancestor to re-clone, exactly as React's own Fabric renderer does. The documentation site's
architecture guide explains the pieces; this file is the rules they have to keep.

## Non-goals

- No webview rendering, and no Capacitor, Lynx or NativeScript underneath.
- No fork of `react-native` or `expo`.
- No running third-party **React** components. Their bodies call hooks off a dispatcher that is
  null here, and two renderers cannot co-own one Fabric shadow tree. Third-party **native views**
  and **TurboModules** are reachable, and they are the reuse path: register the view's Fabric name
  and drive it directly.
- No SSR, no hydration, and no DOM emulation layer.

## Rules

Each of these is load-bearing. Breaking one does not degrade the architecture, it invalidates it.

**AOT only, and `ngDevMode` is false in a release build.** Release bundles are Hermes bytecode,
Hermes has no local-mode `eval()`, and shipping `@angular/compiler` for JIT would be large and
useless. `initNgDevMode()` treats an _undefined_ `ngDevMode` as dev, and Metro does not replace
the identifier the way the Angular CLI does, so `withAngularNative()` does: it folds `ngDevMode` to
`false` in Terser's `global_defs`, which strips the dev-mode branches from a minified bundle, and
its `ng-dev-mode` polyfill sets it `false` before `@angular/core` evaluates in any bundle that is
not dev, which covers a release not minified by Terser.
`examples/canary/scripts/check-release-bundle.mjs` asserts the AOT half: no compiler-only symbol in
the bundle.

**Zoneless only.** zone.js fights Hermes. Signals are the grain of the whole project, which is also
why forms are Signal Forms rather than Reactive Forms.

**No `@angular/platform-browser` bootstrap.** `mount()` in `@ng-native/platform` bootstraps over
`@angular/core` alone. `@angular/router` imports platform-browser statically (for `Title`), so the
package is in the bundle; what is ruled out is booting through it or relying on its DOM.

**The engine never imports Angular or React Native.** Angular-specific code lives in
`@ng-native/platform` and above. That keeps the commit logic testable in Node with no Angular in
the loop and leaves a second framework adapter possible. React Native's JavaScript is Flow, so the
host injects what the engine needs (`processColor`, for one) rather than the engine importing it.
`eslint.config.mjs` enforces this with `bannedExternalImports` on the `layer:runtime` tag, and the
rule needs Nx's project graph, so lint through `nx`, never bare `eslint`.

**At most one commit per change-detection pass.** `RendererFactory2.end()` is the flush point, and
a pass that dirtied nothing must not reach `completeRoot`: any listener marks its view for refresh,
so a scroll or a keystroke schedules a pass whether or not anything changed, and an unconditional
commit is a wasted native commit per frame during a fling. The exceptions are frames that advance
on their own clock: a JavaScript-driven `Animated` frame and a CSS transition or animation commit
outside change detection, because waiting for the next pass would drop the frame.

**Element names in templates are lowercase.** `<view>`, `<scroll-view>`, `<text-input>`. This is
not style: `@oxc-angular/vite` silently emits an empty template (`decls: 0`, no errors, no
warnings) for any component whose template contains an element name with a leading capital, so
`<View>` compiles to a blank screen on a green build. The Metro transform fails the build on it,
checking every `decls:` in a file, since one file can hold several components and only one of them
may be broken.

**`@angular/core` resolves to exactly one copy.** Injection context is module-level state, so two
copies fail at runtime with `NG0203` at `createComponent`, which looks nothing like a duplication
problem. The same holds for every native module: `pnpm-workspace.yaml` pins them with `overrides`.

**Versions follow the Expo SDK.** React Native is pinned to the version the Expo SDK bundles, not
the newest: a newer one breaks `@expo/metro-config`. `npx expo install --check` is the authority.
