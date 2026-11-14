/**
 * `<expo-map>`: `expo-maps`' Apple map on iOS and its Google map on Android, with markers,
 * polylines, polygons and circles, a camera, and taps.
 *
 * ```ts
 * registerExpoMap(Platform.OS); // once, at startup
 *
 * @Component({
 *   imports: [MapView],
 *   template: `
 *     <expo-map class="flex-1" [markers]="stations" [cameraPosition]="london"
 *       (markerClick)="open($event.nativeEvent.id)" />
 *   `,
 * })
 * export class Stations {
 *   private readonly map = viewChild.required(MapView);
 *   zoomIn() { this.map().setCameraPosition({ coordinates: KINGS_CROSS, zoom: 16 }); }
 * }
 * ```
 *
 * One element rather than one per platform because the two views share everything an app reaches
 * for first: a marker list, a camera position, the same three events and the same two view
 * functions. What differs is inside the option objects, and each platform's native side reads only
 * the fields it knows, so an app writes one template. The enum-valued options are the exception
 * (a map type is `STANDARD` on iOS and `NORMAL` on Android) and are typed as either.
 *
 * Each input goes straight to the view as the prop `expo-maps` names it, except that a shape's
 * colours are converted first, as `expo-maps`' own React components run them through
 * `processColor`: native reads the converted value. The outputs are declared
 * for their types only and are never emitted: the view's own event is what reaches `(markerClick)`,
 * as with the components in `expo-ui-components.ts`, so `$event` is a native event and the payload
 * is its `nativeEvent`.
 *
 * `setCameraPosition` and `selectMarker` are the functions `expo-maps` defines on the view. In
 * React they are methods on a ref; underneath, native finds the view by the `nativeTag` it is
 * called with, so they are called here with the tag the engine committed the view under. On macOS
 * they are the desktop host's `NgNativeMaps`'s, which take the tag as their first argument.
 *
 * A committed view has a tag before native has mounted anything under it, and a function called
 * in between finds no view to run on. So calls are held until the map says it is there, which both
 * platforms do with a camera move once it first appears, and `ready` says whether it has.
 */
import {
  Component,
  DestroyRef,
  computed,
  ElementRef,
  InjectionToken,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Engine, type EngineNode, type NativeSyntheticEvent } from '@ng-native/fabric';
import type { AppleMaps, CameraMoveEvent, Coordinates, GoogleMaps } from 'expo-maps';
import { desktopHost } from './desktop-host.ts';
import { expoModule, optional } from './native.ts';
import { registerExpoView } from './register-expo-view.ts';

/** `expo-maps`' types with its enums as their string values, so no import of the module is needed. */
type Plain<T> = T extends string
  ? `${T}`
  : T extends readonly (infer U)[]
    ? readonly Plain<U>[]
    : T extends object
      ? { readonly [K in keyof T]: Plain<T[K]> }
      : T;

export type MapCoordinates = Coordinates;
export type MapCameraPosition = import('expo-maps').CameraPosition;

/**
 * A marker. `id`, `coordinates` and `title` work on both platforms; `systemImage`, `monogram` and
 * `tintColor` are Apple's, `snippet`, `draggable`, `showCallout`, `anchor` and `zIndex` Google's.
 */
export type MapMarker = Plain<AppleMaps.Marker> & Plain<Omit<GoogleMaps.Marker, 'icon'>>;

/** The map's properties: Apple's on iOS, Google's on Android. */
export type MapProperties = Plain<AppleMaps.MapProperties> | Plain<GoogleMaps.MapProperties>;

/** Which controls the map shows. Each platform reads the settings it has. */
export type MapUiSettings = AppleMaps.MapUISettings & GoogleMaps.MapUISettings;

/** `LIGHT` and `DARK` on both; `AUTOMATIC` is iOS's and `FOLLOW_SYSTEM` Android's. */
export type MapColorScheme = `${AppleMaps.MapColorScheme}` | `${GoogleMaps.MapColorScheme}`;

/** A colour, as a template writes one: `'#ff5a36'`, `'rgba(0, 0, 0, 0.5)'`, `'green'`. */
export type MapColor = string;

/**
 * A line through `coordinates`, such as a route. `contourStyle` is Apple's, `geodesic` Google's:
 * both draw the line along the Earth's curve rather than straight across the map.
 */
export interface MapPolyline {
  readonly id?: string;
  readonly coordinates: readonly MapCoordinates[];
  readonly color?: MapColor;
  readonly width?: number;
  readonly contourStyle?: `${AppleMaps.ContourStyle}`;
  readonly geodesic?: boolean;
}

/** A filled shape with `coordinates` as its corners. */
export interface MapPolygon {
  readonly id?: string;
  readonly coordinates: readonly MapCoordinates[];
  readonly color?: MapColor;
  readonly lineColor?: MapColor;
  readonly lineWidth?: number;
}

/** A filled circle, `radius` metres across from `center`. */
export interface MapCircle {
  readonly id?: string;
  readonly center: MapCoordinates;
  readonly radius: number;
  readonly color?: MapColor;
  readonly lineColor?: MapColor;
  readonly lineWidth?: number;
}

/** Where to move the camera. `duration`, in milliseconds, is Android's; iOS does not animate it. */
export type MapCameraMove = MapCameraPosition & { readonly duration?: number };

export interface MapSelectOptions {
  /** The zoom to animate to. */
  readonly zoom?: number;
  /** Whether to move the camera to the marker at all. Defaults to true. */
  readonly moveCamera?: boolean;
}

export type MapClickEvent = NativeSyntheticEvent<{ readonly coordinates: MapCoordinates }>;
export type MapMarkerClickEvent = NativeSyntheticEvent<MapMarker>;
export type MapCameraMoveEvent = NativeSyntheticEvent<CameraMoveEvent>;
/** A tapped shape, as native holds it: its colours are native's own values, not strings. */
type Tapped<T> = Omit<T, 'color' | 'lineColor'> & {
  readonly color?: unknown;
  readonly lineColor?: unknown;
};
export type MapPolylineClickEvent = NativeSyntheticEvent<Tapped<MapPolyline>>;
export type MapPolygonClickEvent = NativeSyntheticEvent<Tapped<MapPolygon>>;
/** Android sends the circle's `center` and where it was tapped; iOS sends its centre as `coordinates`. */
export type MapCircleClickEvent = NativeSyntheticEvent<
  Omit<Tapped<MapCircle>, 'center'> & {
    readonly center?: MapCoordinates;
    readonly coordinates?: MapCoordinates;
    readonly clickCoordinates?: MapCoordinates;
  }
>;

/** The functions `expo-maps` defines on both views, called with the view's tag as `this`. */
export interface MapViewFunctions {
  setCameraPosition(this: { nativeTag: number }, position?: MapCameraMove): Promise<void>;
  selectMarker(this: { nativeTag: number }, id?: string, options?: MapSelectOptions): Promise<void>;
}

/**
 * Make `<expo-map>` commit as the platform's map: `ExpoAppleMaps` on iOS and macOS, where MapKit
 * draws it, `ExpoGoogleMaps` on Android. Each is its module's only view, so its default. Call once,
 * before the first map.
 */
export function registerExpoMap(platform: 'ios' | 'android' | 'macos'): void {
  registerExpoView('expo-map', platform === 'android' ? 'ExpoGoogleMaps' : 'ExpoAppleMaps');
}

@Component({
  selector: 'expo-map',
  exportAs: 'map',
  template: '',
  host: {
    '[markers]': 'markers()',
    '[polylines]': 'nativePolylines()',
    '[polygons]': 'nativePolygons()',
    '[circles]': 'nativeCircles()',
    '[cameraPosition]': 'cameraPosition()',
    '[properties]': 'properties()',
    '[uiSettings]': 'uiSettings()',
    '[colorScheme]': 'colorScheme()',
  },
})
export class MapView {
  /** Overridden in a test to move a camera without a map. */
  static readonly SOURCE = new InjectionToken<MapViewFunctions | null>(
    'angular-native.mapViewSource',
    {
      factory: () => {
        const core = optional(
          () => require('expo-modules-core') as typeof import('expo-modules-core'),
        );
        // Only one of the two modules exists on a platform. Each map is its module's default
        // view, so its functions are under the module's own name.
        const functions = (module: string) =>
          core?.requireOptionalNativeModule<{
            ViewPrototypes?: Record<string, MapViewFunctions>;
          }>(module)?.ViewPrototypes?.[module];
        return expoModule(
          'expo-maps',
          () => functions('ExpoAppleMaps') ?? functions('ExpoGoogleMaps'),
          { desktop: desktopMaps },
        );
      },
    },
  );

  private readonly functions = inject(MapView.SOURCE);
  private readonly engine = inject(Engine);
  private readonly node = inject<ElementRef<EngineNode>>(ElementRef).nativeElement;
  private readonly appeared = signal(false);
  /** Calls made before the map appeared, in the order they were made. */
  private held: ((ready: boolean) => void)[] = [];

  readonly markers = input<readonly MapMarker[]>();
  /** Lines, such as a route. */
  readonly polylines = input<readonly MapPolyline[]>();
  /** Filled shapes. */
  readonly polygons = input<readonly MapPolygon[]>();
  readonly circles = input<readonly MapCircle[]>();
  /** Where the camera is. A changed value moves it; so does `setCameraPosition`. */
  readonly cameraPosition = input<MapCameraPosition>();
  readonly properties = input<MapProperties>();
  readonly uiSettings = input<MapUiSettings>();
  readonly colorScheme = input<MapColorScheme>();

  /** A tap on the map, not on a marker. */
  readonly mapClick = output<MapClickEvent>();
  /** A tap on a marker, with the marker as it was given. iOS 18 and later on iOS. */
  readonly markerClick = output<MapMarkerClickEvent>();
  /** The camera moved, by the user or by the app. Also sent once when the map first appears. */
  readonly cameraMove = output<MapCameraMoveEvent>();
  /** A tap on a polyline, a polygon or a circle. iOS 18 and later on iOS. */
  readonly polylineClick = output<MapPolylineClickEvent>();
  readonly polygonClick = output<MapPolygonClickEvent>();
  readonly circleClick = output<MapCircleClickEvent>();

  protected readonly nativePolylines = computed(() =>
    this.polylines()?.map((line) => ({ ...line, color: this.engine.color(line.color) })),
  );
  protected readonly nativePolygons = computed(() =>
    this.polygons()?.map((shape) => this.filled(shape)),
  );
  protected readonly nativeCircles = computed(() =>
    this.circles()?.map((shape) => this.filled(shape)),
  );

  /**
   * Whether the native map is on screen, so its functions can reach it. Until then
   * `setCameraPosition` and `selectMarker` are held, and sent in order once it is.
   */
  readonly ready = this.appeared.asReadonly();

  constructor() {
    const stop = this.engine.setEventListener(this.node, 'topCameraMove', () => this.appear());
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.release(false);
    });
  }

  /**
   * Move the camera. Held until the map is on screen, and false without the module or if the map
   * goes before it gets there: there was never a map to move.
   */
  setCameraPosition(position: MapCameraMove): Promise<boolean> {
    return this.call((functions, nativeTag) =>
      functions.setCameraPosition.call({ nativeTag }, position),
    );
  }

  /** Select a marker by its `id`, as a tap would, or clear the selection with none. */
  selectMarker(id?: string, options?: MapSelectOptions): Promise<boolean> {
    return this.call((functions, nativeTag) =>
      functions.selectMarker.call({ nativeTag }, id, options),
    );
  }

  private async call(
    run: (functions: MapViewFunctions, nativeTag: number) => Promise<void>,
  ): Promise<boolean> {
    const functions = this.functions;
    if (!functions) return false;
    if (!this.appeared() && !(await new Promise<boolean>((resolve) => this.held.push(resolve)))) {
      return false;
    }
    const nativeTag = this.engine.tagOf(this.node);
    if (nativeTag === null) return false;
    await run(functions, nativeTag);
    return true;
  }

  private filled<T extends MapPolygon | MapCircle>(shape: T) {
    return {
      ...shape,
      color: this.engine.color(shape.color),
      lineColor: this.engine.color(shape.lineColor),
    };
  }

  private appear(): void {
    if (this.appeared()) return;
    this.appeared.set(true);
    this.release(true);
  }

  /** Let every held call go, to native if the map is there and back to its caller if not. */
  private release(ready: boolean): void {
    const held = this.held;
    this.held = [];
    for (const resolve of held) resolve(ready);
  }
}

/** What the desktop host's `NgNativeMaps` takes: the map's functions, by the view's tag. */
interface MapsHost {
  setCameraPosition(tag: number, position: MapCameraMove | null): Promise<void>;
  selectMarker(tag: number, id: string | null, options: MapSelectOptions | null): Promise<void>;
}

/**
 * The map's functions over the desktop host's `NgNativeMaps`, for macOS, where the map is the
 * host's own view and a TurboModule has no view prototypes: each passes its view's tag, and null
 * for an argument left out, which a TurboModule would drop.
 */
function desktopMaps(): MapViewFunctions | null {
  const host = desktopHost<MapsHost>('NgNativeMaps')?.module;
  if (!host) return null;
  return {
    setCameraPosition(position) {
      return host.setCameraPosition(this.nativeTag, position ?? null);
    },
    selectMarker(id, options) {
      return host.selectMarker(this.nativeTag, id ?? null, options ?? null);
    },
  };
}
