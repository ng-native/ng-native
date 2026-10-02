---
title: What does not carry over
summary: The router has no browser build; worklet animation and gesture handling are inert there.
---

# What does not carry over

`@ng-native/router` is `react-native-screens` end to end and has no browser build. A page's
`<native-header>` renders as an inert, invisible box on the web; `<native-stack-outlet>` and
`<native-tabs-outlet>` are not there at all. Angular's own `<router-outlet>` works unmodified
instead, because it is renderer-agnostic - it drives `ViewContainerRef` and never touches the DOM
directly - so a routed app on the web wants Angular's plain outlet and `routerLink`, not the
native-specific ones.

Reanimated worklets and `react-native-gesture-handler` are native-only too, and inert on the web.
Through the `browser` condition in the package's `exports`, a browser build resolves
`@ng-native/components/reanimated` and `@ng-native/components/gestures` to files that reach neither
library, whether or not either is installed. The names are the same, so a template that uses them
renders on both:

- `WorkletStyle`, `WorkletScroll` and `NativeGesture` take their input and do nothing with it. No
  style is applied, no scroll handler runs and no gesture is recognised.
- `<gesture-root>` is a box that fills its parent, as it is on a device.
- `sharedValue(initial)` is a plain holder with Reanimated's `value`, `get()`, `set()`, `modify()`,
  `addListener()` and `removeListener()`.
- `workletStyle()` and `workletScroll()` return the same spec objects they do on a device.

The libraries themselves resolve to inert stand-ins in a browser build, through `ngNativeWeb()`,
whether or not they are installed, so a component that builds a gesture or a worklet animation
builds for the web too:

- `Gesture.Pan()` and every other builder from `react-native-gesture-handler` take any
  configuration and callbacks and recognise nothing. `State` and `Directions` are the library's
  numbers.
- `withTiming`, `withSpring` and the rest of `react-native-reanimated` return where the animation
  ends and call its callback with `true` at once. `interpolate` and `Extrapolation` are the
  library's own arithmetic, `Easing` curves are the identity, and `makeMutable` is the same plain
  holder as `sharedValue`.
- `scheduleOnRN` and the rest of `react-native-worklets` run the function at once.

The React hooks, such as `useSharedValue` and `useAnimatedStyle`, are not there.

`AnimatedStyle` is not one of them. A browser build resolves `@ng-native/components/animations`
to a React-free `Animated` with the same API, stepped by `requestAnimationFrame`, so the same
component animates on both. Every value there is driven from JavaScript: `useNativeDriver` is
accepted and changes nothing, and decay, loops, `ValueXY` and `Animated.event` are not there.

Everything else genuinely runs the same code: a popover, a dialog, a toast all measure and
position themselves through `engine.measure()` and `dispatchCommand()`, which `BrowserEngine`
answers the same way Fabric's engine does. An overlay on a page built with `mount` is exercising
the real host, not a stand-in built for the occasion.

## Sharing a route config between native and web

If a route config is shared between a native app and a web build of the same components, keep
every route lazy (`loadComponent: () => import(...)`), and expect one extra failure mode a bundler
surfaces that Metro does not: a story or screen that statically imports something native-only
(`@ng-native/router`, `react-native-svg`, an `expo-*` module) will fail that route's whole
chunk to build under Rollup/Vite, because a bundler cannot build a module graph with an
unresolvable edge in it, dynamic import or not. That is a build-time failure, and a runtime
`.catch()` on the lazy loader cannot fix it - by the time anything could catch, the build has
already failed and there is no chunk to load. Use browser-compatible dependencies behind that
import, or split native and web into separate route configurations, to fix the build. A `.catch()`
on the lazy loader is still worth adding, but only to handle a chunk that built fine and failed to
load at runtime - a flaky connection, not an unresolved import.

## The build

A browser build is Vite with `ngNativeWeb()` from `@ng-native/web/vite`, as
[Setting up a browser app](/packages/web#setting-up-a-browser-app) describes. Within that:

- **The Angular CLI's builders are not supported.** Their compiler checks the components' host
  bindings against the browser's DOM schema and rejects React Native's props on elements that are
  not HTML. An Angular web app that hosts islands builds with Vite and `ngNativeWeb()` instead.
- **A library that ships decorated TypeScript source is not compiled.** Angular libraries published
  the usual way, as partial-compiled JavaScript, the `@ng-native/*` packages among them, go through
  `@oxc-angular/vite`'s linker as they would in any Vite app. One that ships decorated TypeScript
  source instead is not compiled, and fails in the browser the way an uncompiled component does: a
  syntax error at its first decorator.
- **`react-native` and `expo` are left out of the bundle, and nothing else native is.** The
  packages `require` those two only on a device. Importing anything else native-only, such as
  `react-native-svg` or an `expo-*` module, fails the build, as the section above describes.
- **Vite does not type-check.** Run `tsc` with a `tsconfig.json` like the one on
  [the setup page](/packages/web#setting-up-a-browser-app) for that.
