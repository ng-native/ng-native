---
title: Native views
summary: Register an Expo module's view, or a community library's, as an element by name.
---

# Native views

Most Expo modules need nothing from this package: `requireNativeModule`, `EventEmitter`,
`SharedObject` and `SharedRef` have no React in them, so a module that only calls into native is
used as its own documentation says. [A module with no
service](/packages/expo/using-a-module#a-module-with-no-service) shows how to load one so that a
test can load the file too. A module that _renders_ needs its view registered as an element by
name, which is what this page covers.

These are all on the bare `@ng-native/expo` import - none of them is bound to one optional module.

```ts
import {
  registerExpoView,
  registerExpoViews,
  registerNativeViews,
  expoViewName,
} from '@ng-native/expo';
```

## The smallest useful example

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
first, takes no name), or `{ ios, android }` for a view named differently on each platform;
`options.defaultProps` are props the module's React component would have applied before native
saw them - `expo-image` resolving a `contentFit` string, for instance.

**`registerExpoViews(...elements)`** registers several known views at once, by element name:

```ts
registerExpoViews('expo-image', 'expo-blur', 'expo-camera');
```

`EXPO_VIEWS` is the table it reads from - the views worth knowing the names of, so an app does not
have to look each one up:

| Element                                | Module view                             | Notes                                                                  |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `expo-image`                           | `ExpoImage`                             | Takes `source` as a list; a single `{ uri }` is wrapped by the caller. |
| `expo-blur`                            | `ExpoBlur` (`ExpoBlurView`)             | A blur of what is _behind_ a view - the one thing CSS cannot express.  |
| `expo-blur-target`                     | `ExpoBlur` (`ExpoBlurTargetView`)       | What a blur samples on Android. A plain view on iOS.                   |
| `expo-video`                           | `ExpoVideo` (`VideoView`)               | `SurfaceVideoView` on Android. Bind `player` to the player's `id`.     |
| `expo-camera`                          | `ExpoCamera`                            | The module's default view. See [Camera](/packages/expo/camera).        |
| `apple-sign-in-button`                 | `ExpoAppleAuthentication`               | See [Sign in with Apple](/packages/expo/apple-sign-in). iOS only.      |
| `expo-symbol`                          | `SymbolModule`                          | SF Symbols, iOS and macOS.                                             |
| `expo-gl`                              | `ExpoGL`                                | Its context is reached through an event rather than a prop.            |
| `expo-glass`                           | `ExpoGlassEffect` (`GlassView`)         | The iOS 26 material, and macOS's. See below.                           |
| `expo-glass-container`                 | `ExpoGlassEffect` (`GlassContainer`)    | Glass views inside merge when they come within `spacing` points.       |
| `expo-mesh-gradient`                   | `ExpoMeshGradient` (`MeshGradientView`) | The one gradient with no CSS spelling.                                 |
| `expo-live-photo`                      | `ExpoLivePhoto` (`LivePhotoView`)       | iOS only.                                                              |
| `expo-maps-google` / `expo-maps-apple` | `ExpoGoogleMaps` / `ExpoAppleMaps`      | Two modules, one view each. Typed as one: [Maps](/packages/expo/maps). |

On Android, `<expo-blur>` on its own draws its tint, not a blur. `expo-blur` blurs there only the
content of a `BlurTargetView` it is given; see
[`expo-blur`'s documentation](https://docs.expo.dev/versions/latest/sdk/blur-view/). Here that is
`<expo-blur-target>`: put what is to be blurred in it, register it with
`registerExpoViews('expo-blur-target')`, and give it to the blur's `[blurTarget]`, with a
`blurMethod` other than `none`. The blur commits the target's view tag as `blurTargetId`, as
`BlurView` does. Elsewhere the target is a plain view.

```ts
import { Component } from '@angular/core';
import { Image } from '@ng-native/components';
import { ExpoBlur, ExpoBlurTarget } from '@ng-native/expo';

@Component({
  imports: [ExpoBlur, ExpoBlurTarget, Image],
  template: `
    <expo-blur-target #behind class="absolute inset-0"><image [source]="photo" /></expo-blur-target>
    <expo-blur class="absolute inset-0" [blurTarget]="behind" blurMethod="dimezisBlurView" />
  `,
})
export class Frosted {
  protected readonly photo = { uri: 'https://example.com/photo.jpg' };
}
```

Registering one you have not installed does not error at registration time; it produces an element
that commits as nothing (`UnimplementedNativeView`), which is why elements are named one at a time
rather than all at once - finding out at startup which modules are actually present is not
something JavaScript can do without importing them all.

## Typed components

A registered element takes whatever props it is given. Every view in `EXPO_VIEWS` also has a
component or directive over the same element that gives it typed inputs, so a template is checked
against the props native reads, and does in Angular what the module's React component does first.
Import it and keep registering the element. `Camera` is on `@ng-native/expo/camera` and `MapView` on
`@ng-native/expo/map-view`; the rest are on the bare `@ng-native/expo` import:

| Component            | Element                                | What it adds                                                                                                                                                                                                         |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExpoImage`          | `expo-image`                           | `source` and `contentFit` typed.                                                                                                                                                                                     |
| `ExpoBlur`           | `expo-blur`                            | `tint`, `intensity`, and Android's `blurMethod`, `blurReductionFactor` and `blurTarget`.                                                                                                                             |
| `ExpoBlurTarget`     | `expo-blur-target`                     | Its content, which a blur's `blurTarget` samples on Android.                                                                                                                                                         |
| `ExpoVideo`          | `expo-video`                           | `expo-video`'s view props. `player` takes a `videoPlayer()` or its id. Full screen and picture in picture functions on iOS and Android (`stopPictureInPicture()` on iOS only). See [Players](/packages/expo/player). |
| `Camera`             | `expo-camera`                          | `expo-camera`'s view props, `flash` and `autofocus` committed as the `flashMode` and `autoFocus` native reads, and the view's functions. See [Camera](/packages/expo/camera#view-props).                             |
| `ExpoGL`             | `expo-gl`                              | `msaaSamples`, `enableExperimentalWorkletSupport`, and `surfaceCreate` typed.                                                                                                                                        |
| `ExpoGlass`          | `expo-glass`                           | `glassEffectStyle` (`regular`, `clear`, `none`), `tintColor`, `isInteractive`, `colorScheme`.                                                                                                                        |
| `ExpoGlassContainer` | `expo-glass-container`                 | `spacing`.                                                                                                                                                                                                           |
| `ExpoMeshGradient`   | `expo-mesh-gradient`                   | `columns`, `rows`, `points`, `colors`, `smoothsColors`, and iOS's `mask` and `ignoresSafeArea`.                                                                                                                      |
| `ExpoLivePhoto`      | `expo-live-photo`                      | `source`, `isMuted`, `contentFit`, `useDefaultGestureRecognizer`, the load and playback events, and `startPlayback(style?)` and `stopPlayback()`. iOS only.                                                          |
| `ExpoSymbol`         | `expo-symbol`                          | `name`, `type` (`monochrome` unless set), `weight`, `scale`, `colors`, a `size` as a point size, 24 unless set.                                                                                                      |
| `MapView`            | `expo-maps-apple` / `expo-maps-google` | The same component as `<expo-map>`. See [Maps](/packages/expo/maps).                                                                                                                                                 |
| `AppleSignInButton`  | `apple-sign-in-button`                 | `buttonType` and `buttonStyle` by name. See [Sign in with Apple](/packages/expo/apple-sign-in).                                                                                                                      |

A boolean prop works bound, `[mute]="muted()"`, or written bare, `<expo-camera mute />`, when the
component is imported: the bare attribute is true, as in HTML, and `null` or `undefined` leaves the
prop to native's default. On an element with no component imported, a bare attribute reaches native
as an empty string, which iOS, Android and macOS each drop for a boolean prop, so the prop is never
set. Most inputs left unset commit nothing, so native keeps its own default, or the one the
registration sets: `<expo-blur>` is registered with `intensity` 50 and `tint` `default`. An input
whose module's React component sends a default of its own commits that default in place of
native's: `ExpoSymbol`'s `type` is `monochrome`, `Camera`'s `flash` is `off`, and on iOS
`ExpoGL`'s `msaaSamples` is 4.

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

Where Liquid Glass is unavailable, before iOS 26 and on Android, `<expo-glass>` renders as a plain
view, so its fallback background is the app's to set. On macOS the desktop host draws
NSGlassEffectView from macOS 26, and a frosted material before it, in the element's own corners;
`<expo-glass-container>` is a plain view there, each glass view inside drawing its own.

A symbol's color is its `tintColor`, and `tint-color` in a stylesheet is the declaration that sets
it, so that is how a symbol takes its color from a token and follows a theme:
`.like { tint-color: var(--color-accent); }` on `<expo-symbol class="like">`. `color` does not tint
a symbol: it is the color of text. A `tintColor` written on the element wins over the stylesheet.

A symbol's `size` is a point size, as SwiftUI's `.font(.system(size:))` takes it: the symbol draws
as large as SwiftUI draws it, and its view is the size of the symbol's image at that point size,
weight and scale, which is wider or taller than `size` for most symbols, as SwiftUI lays an
`Image(systemName:)` out. A badged symbol, such as `calendar.badge.plus`, differs in width:
SwiftUI leaves the badge's overhang out of it, and `<expo-symbol>` keeps it in. This takes
`@ng-native/expo`'s native module, so a development build. In Expo Go the view is `size` points
square and the symbol is fitted into it, which draws most symbols smaller.

On macOS the desktop host draws the symbol with AppKit and sizes its view the same way. It draws
the type, weight, scale, colors and `resizeMode`, and plays no `animationSpec`.

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
| `date-time-picker`       | `@react-native-community/datetimepicker`            | iOS and macOS. See below.                                                    |
| `picker` / `picker-item` | `@react-native-picker/picker`                       | Items are `<picker-item>` children.                                          |
| `segmented-control`      | `@react-native-segmented-control/segmented-control` | iOS and macOS. See below.                                                    |
| `masked-view`            | `@react-native-masked-view/masked-view`             | `maskElement` is a prop, not a child.                                        |
| `pager-view`             | `react-native-pager-view`                           | The swipeable pager a tab layout is built on.                                |
| `lottie-view`            | `lottie-react-native`                               |                                                                              |
| `skia-view`              | `@shopify/react-native-skia`                        | Takes an imperative `picture`; declarative Skia elements do not come across. |
| `view-shot`              | `react-native-view-shot`                            | Captures whatever it wraps.                                                  |

`segmented-control` is a view manager from before Fabric, run through the interop layer, which
only installs its `onChange` native block when the prop is set - as React's handler does by being
there. Bind `(change)` or nothing fires. `SegmentedControl` (`segmented-control.ts`) is a thin
typed component over this element for strict templates, and it registers the element the first time
one is made, so an app that imports it needs no `registerNativeViews` call; `DateTimePicker` does
the same for its own. On iOS the library still has to be installed. On macOS the desktop host draws
both as AppKit controls, with no library installed.

On macOS `slider`, `picker` and `masked-view` are absent: their libraries have no macOS view, so
the element is a plain view and the desktop host's view registry reports it missing. Use
`ui-slider` and `ui-picker` from `@expo/ui`, which are SwiftUI's slider and picker there, or for
a picker a `<pressable>` whose [`[menu]`](/packages/components/menus#menus-on-a-press) lists the
choices; a masked view's content shows unmasked.

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
nothing there. Show the picker on iOS and macOS, and on Android open the library's dialog from a
press with its own `DateTimePickerAndroid.open()`.

`skia-view`'s name is right, but worth being plain about: Skia's drawing model is React elements
through a reconciler of its own, and none of that is reachable here. What the element takes is a
`picture`, built with Skia's imperative `PictureRecorder` API. Anything drawn declaratively does
not come across, and a component that renders nothing is what that looks like.

## Deriving the name yourself

**`expoViewName(moduleName, viewName?)`** returns the Fabric component name of an Expo module's
view, including the per-app suffix Expo Go adds, for registering a name some other way than
`registerExpoView`, which calls it for you. A wrong name commits as `UnimplementedNativeView` with
no error.

## Without the module

An element registered for a module or library that is not installed commits as nothing
(`UnimplementedNativeView`) rather than throwing - the same failure mode as a misspelled element
name, so check the name and the install first.

## Reference

<!-- api: DateTimePicker -->

<!-- api: SegmentedControl -->
