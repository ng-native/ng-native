---
title: Architecture
summary: How Angular's Renderer2 drives Fabric directly, with no React tree or reconciler.
---

# Architecture

Angular components call `Renderer2` rather than manipulating nodes. `@angular/platform-browser`
implements that interface with calls such as `document.createElement`; `@angular/core` requires
no DOM.

`@ng-native/platform` provides a `Renderer2` and a `RendererFactory2` that build a retained tree
for React Native's Fabric renderer. Fabric turns it into `UIView`s and Android `View`s. Angular
replaces React's JavaScript and drives the same C++ renderer, with no React element tree,
reconciler or `react-dom` equivalent.

## Rendering packages and responsibilities

```
@ng-native/components  one component per native view, plus the behaviour composed into them
@ng-native/platform    Renderer2 over the engine, and bootstrap
@ng-native/fabric      the engine: retained tree, commit, events, CSS
```

The engine has no Angular dependency: `@nx/enforce-module-boundaries` bans `@angular/*` imports
in `@ng-native/fabric`, catching dependencies the tests would miss. It also has no dependency on
React Native's JavaScript; the host supplies what it needs.

`@ng-native/platform` contains the only Angular-aware renderer code, fulfilling the role of
`@angular/platform-browser` for the DOM.

## What a commit is

The engine holds a **retained tree** of elements, text and anchors. Anchors participate in sibling
ordering but never reach Fabric. Angular's structural directives use them as placeholders for
absent views.

The engine records Angular's individual renderer calls to create elements, set props and move
children, then commits at most once per change-detection pass. Commits are incremental: unchanged
subtrees return to Fabric by reference, avoiding rebuilds that would impair scrolling.

Each commit ends with one call to Fabric's `completeRoot`, which diffs the new root against the
screen in C++, off the JavaScript thread.

## The host seam

Two hosts share an explicit contract.

`HostEngine` and `HostNode`, in `@ng-native/fabric`, define only the calls the shared packages
make. Fabric's `Engine` implements the former and `EngineNode` extends the latter, preserving the
native path. `@ng-native/web`'s `BrowserEngine` implements both over the DOM without casts.

`worklet-style`, `worklet-scroll` and `native-gesture` sit outside this interface. They inject the
concrete `Engine` to access Fabric handles for Reanimated and react-native-gesture-handler, rather
than answer wrongly through a browser stub. On the web, these native-only dependencies raise
Angular's `NullInjectorError` naming `Engine`.

## CSS

Angular components declare CSS in `styles` and `styleUrl`. Native has no CSS engine, and only
`platform-browser` provides the `SHARED_STYLES_HOST` that receives Angular's `styles`. Without its
own engine, Angular Native would silently drop component stylesheets.

Angular Native handles CSS at build time and runtime.

**At build time**, lightningcss parses component stylesheets inside the Metro transform. It converts
values for React Native, compiles selectors into compounds and combinators, and sorts rules by
specificity then source order. The device does no sorting. The rule set attaches to the component
class as a static, which also scopes it: `RendererFactory2.createRenderer(host, type)` receives
the component definition, whose class reference lets the renderer find its stylesheet without a
registry or generated ID.

There is no runtime CSS parser: lightningcss is a native Node addon.

**At runtime**, `packages/fabric/src/css.ts` matches and merges rules. It matches right-to-left
so the rightmost compound rejects most candidates immediately. Precedence, weakest first: native
defaults, matched CSS, explicit props, inline `[style]`, `!important`.

The cascade emulates inheritance for `color`, `font*`, `lineHeight`, `letterSpacing`, `textAlign`,
`textTransform` and `textDecorationLine`. React Native does not inherit text properties: a view's
`color` does not affect its text children. Without this propagation, browser-style sheets would
silently lose inherited colors.

## The scope rule

**If React Native can express it, CSS gets a spelling for it. If it cannot, the build drops it and
warns.**

`elevation` compiles because React Native accepts it, even though it has no effect on iOS; no-oping
on one platform is React Native's own semantics. `float` has no native equivalent, so it is dropped
with a build warning naming the file, the line and the reason; dropping it without a word would
hide the problem.

`::before`, `::after`, grid, table layout, `position: fixed` and `position: sticky` are permanently
unsupported - their warnings say so rather than "not yet". React Native's style API cannot express
them. A pseudo-element,
for example, requires a node absent from the template, making the rendered tree diverge from the
code. Declare the element in the template instead.

## Events

Fabric dispatches events by node tag. The engine keeps the handler table, runs React Native's
responder negotiation (capture down, bubble up, one node holding the gesture), and calls Angular.
It uses React Native's event system without adding a synthetic layer.

## Routing

`@angular/router` owns URLs, guards, resolvers and lazy loading. `<native-stack-outlet>` renders
each activated route into an `RNSScreen` from react-native-screens. Pushes use native transitions
and back gestures. Screens below the top stay mounted, preserving scroll positions and text-field
state.

Push, sheet and full-screen modal presentation travel as navigation state, keeping URLs typable,
shareable and deep-linkable.
