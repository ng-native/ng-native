---
title: Maps
summary: <expo-map> - Apple Maps on iOS and Google Maps on Android, with markers, shapes, a camera
  and taps.
---

# Maps

`MapView` is `expo-maps` as one element: `<expo-map>` commits as Apple Maps on iOS and as Google
Maps on Android. It takes markers, polylines, polygons, circles and a camera position, sends map,
marker and shape taps and camera moves, and moves the camera from code. It is a thin mapping onto
`expo-maps`: every input is the prop `expo-maps` reads under the same name, and nothing is added on
top.

## Install

```sh
npx expo install expo-maps
```

```ts
import { MapView, registerExpoMap } from '@ng-native/expo/map-view';
```

`expo-maps` adds native code, so the app needs a native rebuild (`npx expo run:ios`,
`npx expo run:android`, or a new EAS build). It does not run in Expo Go.

**iOS** needs no key: Apple Maps is part of the system. The map renders on iOS 17 and later (it is
an empty view before that), and marker taps need iOS 18.

**Android** needs a Google Maps API key with the Maps SDK for Android enabled, in `app.json`:

```json
{
  "expo": {
    "android": {
      "config": {
        "googleMaps": { "apiKey": "YOUR_ANDROID_MAPS_KEY" }
      }
    }
  }
}
```

**The user's location** (`isMyLocationEnabled`) needs the location permission. `expo-maps`' config
plugin adds it when asked, writing `NSLocationWhenInUseUsageDescription` into `Info.plist` and the
location permissions into the Android manifest:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-maps",
        {
          "requestLocationPermission": true,
          "locationPermission": "Allow $(PRODUCT_NAME) to show where you are on the map"
        }
      ]
    ]
  }
}
```

Then ask for it at runtime, for example with [Location](/packages/expo/location). A map without the
user's location needs neither.

## The smallest thing that works

```ts
import { Component, signal, viewChild } from '@angular/core';
import { Platform } from 'react-native';
import { Pressable, Text } from '@ng-native/components';
import { MapView, registerExpoMap, type MapMarker } from '@ng-native/expo/map-view';

registerExpoMap(Platform.OS as 'ios' | 'android'); // once, before the app mounts

const KINGS_CROSS = { latitude: 51.5308, longitude: -0.1238 };

@Component({
  selector: 'app-stations',
  imports: [MapView, Pressable, Text],
  template: `
    <expo-map
      class="flex-1"
      [markers]="stations"
      [cameraPosition]="{ coordinates: { latitude: 51.52, longitude: -0.15 }, zoom: 12 }"
      (markerClick)="picked.set($event.nativeEvent.title ?? '')"
    />
    <text>{{ picked() }}</text>
    <pressable (press)="zoomToKingsCross()"><text>King's Cross</text></pressable>
  `,
})
export class Stations {
  private readonly map = viewChild.required(MapView);
  protected readonly picked = signal('');
  protected readonly stations: MapMarker[] = [
    { id: 'kings-cross', title: "King's Cross", coordinates: KINGS_CROSS },
    {
      id: 'paddington',
      title: 'Paddington',
      coordinates: { latitude: 51.5154, longitude: -0.1755 },
    },
  ];

  protected zoomToKingsCross(): void {
    this.map().setCameraPosition({ coordinates: KINGS_CROSS, zoom: 16 });
  }
}
```

Give the map a size. It fills whatever box it is given and has no size of its own, so a map with
neither a height nor `flex: 1` is not on screen.

## Registering the view

`registerExpoMap(platform)` teaches the engine that `<expo-map>` is `ExpoAppleMaps`' view on iOS and
`ExpoGoogleMaps`' on Android. Each is the only view of its module, so its Fabric name is the
module's default: `ViewManagerAdapter_ExpoAppleMaps` and `ViewManagerAdapter_ExpoGoogleMaps`. Call
it once at startup, before the first map commits.

If you would rather write each platform's element yourself, `registerExpoViews('expo-maps-apple')`
and `registerExpoViews('expo-maps-google')` register the same two views under those names (see
[Native views](/packages/expo/native-views)); they are untyped elements.

## Inputs

- **`markers`** - the pins. `id`, `coordinates` and `title` work on both platforms, and the `id` is
  how a tap says which marker it was. `systemImage` (an SF Symbol), `monogram` and `tintColor` are
  Apple's; `snippet`, `draggable`, `showCallout`, `anchor` and `zIndex` are Google's. Each platform
  ignores the other's.
- **`polylines`** - lines, such as a route: `{ id, coordinates, color, width }`. To draw one along
  the Earth's curve, set `contourStyle` to `'GEODESIC'` for iOS and `geodesic` to `true` for
  Android.
- **`polygons`** - filled shapes: `{ id, coordinates, color, lineColor, lineWidth }`, with the
  corners as `coordinates`.
- **`circles`** - filled circles: `{ id, center, radius, color, lineColor, lineWidth }`, with the
  `radius` in meters.
- **`cameraPosition`** - `{ coordinates, zoom }`. Setting a new value moves the camera.
- **`properties`** - `expo-maps`' map properties: `mapType`, `isTrafficEnabled`,
  `isMyLocationEnabled`, `selectionEnabled`, and each platform's own (`elevation`,
  `pointsOfInterest` on iOS; `isBuildingEnabled`, `minZoomPreference`, `mapStyleOptions` on
  Android...).
- **`uiSettings`** - which controls are shown: `compassEnabled`, `myLocationButtonEnabled`,
  `scaleBarEnabled`, `togglePitchEnabled` on both, and Google's zoom, gesture and toolbar switches.
- **`colorScheme`** - `LIGHT` or `DARK` on both, `AUTOMATIC` on iOS, `FOLLOW_SYSTEM` on Android.

`expo-maps`' enums are typed as their string values, so `mapType: 'HYBRID'` needs no import of
`expo-maps` itself. A shape's colors are written as a template writes any color (`'#ff5a36'`,
`'rgba(0, 128, 0, 0.5)'`, `'green'`) and converted before they reach native, as `expo-maps`' own
React components convert them.

A route that grows as fixes arrive is a `computed` over the fixes, and the map redraws the line
each time it changes:

```ts
import { Component, computed, signal } from '@angular/core';
import { MapView, type MapCoordinates, type MapPolyline } from '@ng-native/expo/map-view';

@Component({
  selector: 'app-route',
  imports: [MapView],
  template: `<expo-map class="flex-1" [polylines]="route()" />`,
})
export class Route {
  protected readonly fixes = signal<MapCoordinates[]>([]);
  protected readonly route = computed<MapPolyline[]>(() => [
    { id: 'route', coordinates: this.fixes(), color: '#ff5a36', width: 5 },
  ]);
}
```

## Outputs

Each is the view's own event, so the payload is `$event.nativeEvent`:

- **`(mapClick)`** - a tap on the map, not on a marker: `{ coordinates }`.
- **`(markerClick)`** - a tap on a marker: the marker as you gave it, with its `id`.
- **`(cameraMove)`** - the camera moved: its `coordinates`, `zoom`, `tilt` and `bearing`, and the
  visible region's `latitudeDelta` and `longitudeDelta`. Also sent once when the map first appears.
- **`(polylineClick)`**, **`(polygonClick)`**, **`(circleClick)`** - a tap on a shape: the shape,
  with its `id`. Its colors come back as native holds them rather than as the strings you gave.

## Moving the camera from code

**`setCameraPosition({ coordinates, zoom, duration })`** moves the camera, and
**`selectMarker(id, { zoom, moveCamera })`** selects a marker as a tap would (no `id` clears the
selection). Both resolve to `true` once the view has been asked, and to `false` without the module.

A call made before the native map is on screen is held, not dropped, and sent in order once it is:
calling from a constructor or an `effect` that runs as the screen opens is safe. The map says it is
there with its first camera move, on both platforms, and **`ready`** is a signal of whether it has.
A held call resolves to `false` if the map goes before it ever appears.

In React these are methods on the map's ref. Underneath they are functions `expo-maps` defines on
the view, which native finds by the tag it is called with; `MapView` calls them with the tag the
engine committed the view under, so a `viewChild` is all you need.

## Platform differences

- The option enums differ: a plain map is `mapType: 'STANDARD'` on iOS and `'NORMAL'` on Android,
  and satellite is `'IMAGERY'` and `'SATELLITE'`. Each platform's native side only knows its own
  values, so choose per platform where they differ.
- `duration` in `setCameraPosition` is Android's; iOS moves without it.
- Marker and shape taps need iOS 18. On iOS 17 the map, its markers and its shapes show, and
  `(markerClick)`, `(polylineClick)`, `(polygonClick)` and `(circleClick)` never fire.
- A tapped circle's center is `coordinates` on iOS and `center` on Android, where
  `clickCoordinates` also says where the tap landed.
- Apple markers take `systemImage`, `monogram` and a `tintColor` color string; Google markers take
  a `snippet` and can be dragged.

## Limits

- The inputs and outputs are what `expo-maps` supports on both platforms. Apple's annotations and
  `selectAnnotation`, and Google's `userLocation`, `contentPadding` and `mapOptions`, are one
  platform's only and not typed here; neither is a Google marker's `icon`, which is an image shared
  object this does not map yet.
- Google's `onMapLoaded`, `onMapLongClick` and `onPOIClick`, Google Street View, and Apple's Look
  Around are not wrapped.
- `expo-maps` is marked alpha by Expo and may change between SDK versions.

## Reference

<!-- api: MapView -->
