---
title: Native views
summary: Register an Expo module's view, or a community library's, as an element by name.
---

# Native views

Most Expo modules need nothing from this package: `requireNativeModule`, `EventEmitter`,
`SharedObject` and `SharedRef` have no React in them, so a module that only calls into native is
imported and used as its own documentation says. What needs something is a module that _renders_.
Its React wrapper reaches the Fabric component through `requireNativeViewManager`, which caches a
host component, builds a view config for React's renderer, and derives the Fabric component's
name from the module name. None of the React parts are reachable without React, and none of them
are needed - the engine writes props onto the shadow node itself, and Expo's Fabric views take
their props as an untyped map, so there is no codegen'd prop list to satisfy. What is left, and
what this page is about, is the name.

These are all on the bare `@ng-native/expo` import - none of them is bound to one optional module.

```ts
import {
  registerExpoView,
  registerExpoViews,
  registerNativeViews,
  expoViewName,
} from '@ng-native/expo';
```

## The smallest thing that works

```ts
import { registerExpoViews, registerNativeViews } from '@ng-native/expo';

registerExpoViews('expo-image', 'expo-blur'); // once, before the app mounts
registerNativeViews('web-view', 'slider');
```

```html
<expo-image [source]="[{ uri }]" contentFit="cover" [transition]="{ duration: 400 }" />
```

`<expo-image>` is then an element like any other, and its props are the ones the module's native
view declares - the ones the React component would have passed down, after whatever resolving it
does in JavaScript.

## Expo's own views

**`registerExpoView(elementName, moduleName, options?)`** teaches the engine an element name for
one Expo module's view: `registerExpoView('expo-image', 'ExpoImage')` makes `<expo-image>` commit
as one. Call it at startup, before the first commit that uses the element - the app still has to
have the module installed so the native side registers the component; this only does the
JavaScript half.

`options.viewName` names one of several views a module has (the _default_ view, the module's
first, takes no name); `options.defaultProps` are props the module's React component would have
applied before native saw them - `expo-image` resolving a `contentFit` string, for instance.

**`registerExpoViews(...elements)`** registers several known views at once, by element name:

```ts
registerExpoViews('expo-image', 'expo-blur', 'expo-camera');
```

`EXPO_VIEWS` is the table it reads from - the views worth knowing the names of, so an app does not
have to look each one up:

| Element                                | Module view                             | Notes                                                                  |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `expo-image`                           | `ExpoImage`                             | Takes `source` as a list; a single `{ uri }` is wrapped by the caller. |
| `expo-blur`                            | `ExpoBlurView`                          | A blur of what is _behind_ a view - the one thing CSS cannot express.  |
| `expo-video`                           | `ExpoVideo` (`VideoView`)               | The player is a shared object the module hands out; this is its view.  |
| `expo-camera`                          | `ExpoCamera`                            | The module's default view. See [Camera](/packages/expo/camera).        |
| `apple-sign-in-button`                 | `ExpoAppleAuthentication`               | See [Sign in with Apple](/packages/expo/apple-sign-in). iOS only.      |
| `expo-symbol`                          | `SymbolModule`                          | SF Symbols, iOS only.                                                  |
| `expo-gl`                              | `ExpoGL`                                | Its context is reached through an event rather than a prop.            |
| `expo-glass`                           | `ExpoGlassEffect` (`GlassView`)         | The iOS 26 material. Renders as a plain view where unavailable.        |
| `expo-glass-container`                 | `ExpoGlassEffect` (`GlassContainer`)    | Glass views inside merge when they come within `spacing` points.       |
| `expo-mesh-gradient`                   | `ExpoMeshGradient` (`MeshGradientView`) | The one gradient with no CSS spelling.                                 |
| `expo-live-photo`                      | `ExpoLivePhoto` (`LivePhotoView`)       | iOS only.                                                              |
| `expo-maps-google` / `expo-maps-apple` | `ExpoGoogleMaps` / `ExpoAppleMaps`      | Two modules, one view each. Typed as one: [Maps](/packages/expo/maps). |

Registering one you have not installed does not error at registration time; it produces an element
that commits as nothing (`UnimplementedNativeView`), which is why elements are named one at a time
rather than all at once - finding out at startup which modules are actually present is not
something JavaScript can do without importing them all.

## Typed components

A registered element takes whatever props it is given. For the views an app reaches for most, a
component over the same element gives it typed inputs, so a template is checked against the props
native reads, and does in Angular what the module's React component does first. Import the
component and keep registering the element:

| Component            | Element                | What it adds                                                                                              |
| -------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `ExpoImage`          | `expo-image`           | `source` and `contentFit` typed.                                                                          |
| `ExpoGlass`          | `expo-glass`           | `glassEffectStyle` (`regular`, `clear`, `none`), `tintColor`, `isInteractive`, `colorScheme`.             |
| `ExpoGlassContainer` | `expo-glass-container` | `spacing`.                                                                                                |
| `ExpoSymbol`         | `expo-symbol`          | `name`, `type` (`monochrome` unless set), `weight`, `scale`, `colors`, a `size` in points, 24 unless set. |
| `AppleSignInButton`  | `apple-sign-in-button` | `buttonType` and `buttonStyle` by name. See [Sign in with Apple](/packages/expo/apple-sign-in).           |

```ts
import { Component } from '@angular/core';
import { ExpoGlass, ExpoSymbol, registerExpoViews } from '@ng-native/expo';

registerExpoViews('expo-glass', 'expo-symbol'); // once, before the app mounts

@Component({
  selector: 'app-like',
  imports: [ExpoGlass, ExpoSymbol],
  template: `
    <expo-glass class="size-14 items-center justify-center rounded-full" isInteractive>
      <expo-symbol name="heart.fill" [size]="24" tintColor="#ff2d55" />
    </expo-glass>
  `,
})
export class Like {}
```

A symbol's color is its `tintColor`, and `tint-color` in a stylesheet is the declaration that sets
it, so that is how a symbol takes its color from a token and follows a theme:
`.like { tint-color: var(--color-accent); }` on `<expo-symbol class="like">`. `color` does not tint
a symbol: it is the color of text. A `tintColor` written on the element wins over the stylesheet.

A glass view's corners are its own `border-radius`. Where Liquid Glass is unavailable - before iOS
26, and on Android - `<expo-glass>` renders as a plain view, and `liquidGlassAvailable()` says
which it will be, so a fallback background can be set for the rest.

## Community views

Not every native view an Expo app reaches for is an Expo module. `NATIVE_VIEWS` and
**`registerNativeViews(...elements)`** cover the libraries in Expo's own bundled module list, whose
Fabric names are their own - whatever codegen produced from each library's spec - rather than the
`ViewManagerAdapter_` names `registerExpoView` derives:

| Element                  | Library                                             | Notes                                                                        |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `web-view`               | `react-native-webview`                              |                                                                              |
| `slider`                 | `@react-native-community/slider`                    |                                                                              |
| `date-time-picker`       | `@react-native-community/datetimepicker`            | iOS only. See below.                                                         |
| `picker` / `picker-item` | `@react-native-picker/picker`                       | Items are `<picker-item>` children.                                          |
| `segmented-control`      | `@react-native-segmented-control/segmented-control` | iOS only. See below.                                                         |
| `masked-view`            | `@react-native-masked-view/masked-view`             | `maskElement` is a prop, not a child.                                        |
| `pager-view`             | `react-native-pager-view`                           | The swipeable pager a tab layout is built on.                                |
| `lottie-view`            | `lottie-react-native`                               |                                                                              |
| `skia-view`              | `@shopify/react-native-skia`                        | Takes an imperative `picture`; declarative Skia elements do not come across. |
| `view-shot`              | `react-native-view-shot`                            | Captures whatever it wraps.                                                  |

`segmented-control` is a view manager from before Fabric, run through the interop layer, which
only installs its `onChange` native block when the prop is set - as React's handler does by being
there. Bind `(change)` or nothing fires. `SegmentedControl` (`segmented-control.ts`) is a thin
typed component over this element for strict templates: import it and keep registering the name -
the component supplies the types, the registration is what makes the element commit.

`date-time-picker` is the library's native view, not its React component, so it takes what the
view does and not what the library's README lists: the date is `date`, in milliseconds, where the
README's is `value`; the style is `displayIOS`; and a pick is `(change)` with the moment in
`$event.nativeEvent.timestamp`. `DateTimePicker` is the typed component over the element, as
`SegmentedControl` is over its own. It takes a `Date` or milliseconds for `date`, `minimumDate`
and `maximumDate`:

```ts
import { Component, signal } from '@angular/core';
import { DateTimePicker } from '@ng-native/expo';

@Component({
  selector: 'due-date',
  imports: [DateTimePicker],
  template: `
    <date-time-picker
      mode="date"
      displayIOS="compact"
      [date]="due()"
      (change)="due.set(asDate($event.nativeEvent.timestamp))"
    />
  `,
})
export class DueDate {
  readonly due = signal(new Date());

  protected asDate(timestamp: number): Date {
    return new Date(timestamp);
  }
}
```

On Android the library has no view, only a module that opens a dialog, so the element commits as
nothing there. Show the picker on iOS alone, and on Android open the library's dialog from a press
with its own `DateTimePickerAndroid.open()`.

`skia-view`'s name is right, but worth being plain about: Skia's drawing model is React elements
through a reconciler of its own, and none of that is reachable here. What the element takes is a
`picture`, built with Skia's imperative `PictureRecorder` API. Anything drawn declaratively does
not come across, and a component that renders nothing is what that looks like.

## Deriving the name yourself

**`expoViewName(moduleName, viewName?)`** computes the exact Fabric component name
`requireNativeViewManager` would, for a module `registerExpoView` does not already know about:
`ViewManagerAdapter_<moduleName>` (or `ViewManagerAdapter_<moduleName>_<viewName>` for a named
view), plus a per-app suffix. The suffix is the part that cannot be hardcoded: Expo Go runs many
projects in one binary, so it namespaces every view name with a per-app identifier; a standalone
build has none. Get it wrong and the view commits as `UnimplementedNativeView` with no error - the
same failure mode as a misspelled name. `registerExpoView` calls this for you; reach for it
directly only if you are registering a name some other way.

## Without the module

An element registered for a module or library that is not installed commits as nothing
(`UnimplementedNativeView`) rather than throwing - the same failure mode as a misspelled element
name, so check the name and the install first.

## Reference

<!-- api: DateTimePicker -->

<!-- api: SegmentedControl -->
