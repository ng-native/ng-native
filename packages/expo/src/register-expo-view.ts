/**
 * Expo's native views, driven directly.
 *
 * An Expo module that renders something registers a Fabric component whose name it derives
 * rather than declares, and `requireNativeViewManager` is the only place that derivation is
 * written down. Everything else that function does is React: it caches a host component, builds
 * a view config for React's renderer, and wraps the result in a class whose whole job is to hold
 * a ref. None of that is reachable without React, and none of it is needed - the engine writes
 * props onto the shadow node itself, and Expo's Fabric views take their props as an untyped map,
 * so there is no codegen'd prop list to satisfy.
 *
 * What is left is the name. That is what this package is.
 *
 * No decorators and no Angular here on purpose: this is a registration, and the components it
 * registers are ordinary elements in a template.
 */
import { expoViewName } from '@ng-native/device';
import { registerViewName, type PlatformViewName, type ViewNameOptions } from '@ng-native/fabric';
import { currentPlatform, optional } from './native.ts';

/**
 * The Fabric component name for a module's view, exactly as `requireNativeViewManager` computes
 * it in `expo-modules-core`: the module's name, plus Expo Go's per-app suffix where there is one.
 */
export { expoViewName };

export interface ExpoViewOptions {
  /**
   * A named view on a module that has several. Omit for the module's default view. A module whose
   * view is named differently on each platform names both: `expo-video`'s is `VideoView` on iOS
   * and `SurfaceVideoView` on Android.
   */
  readonly viewName?: string | PlatformViewName;
  /**
   * Props the module's React component would have applied before native saw them. Expo's
   * wrappers do less of this than React Native's, but they do some: `expo-image` resolves a
   * source to an array and a `contentFit` to a string native understands.
   */
  readonly defaultProps?: Record<string, unknown>;
  /** Whether a component of the app's own with this selector is a plain view. */
  readonly yieldsToComponents?: boolean;
  /**
   * The prop the view reads its text from, where it takes no child views, as `@expo/ui`'s `Text`
   * reads `text`. The text written inside the element becomes that prop. See `ViewNameOptions`.
   */
  readonly textContent?: string;
  /** Rewrites the fonts the view's own props name. See `ViewNameOptions`. */
  readonly fontNames?: ViewNameOptions['fontNames'];
}

/**
 * Teach the engine an element name for an Expo module's view, e.g.
 * `registerExpoView('expo-image', 'ExpoImage')` makes `<expo-image>` commit as one.
 *
 * Call it at startup, before the first commit that uses the element. The app must have the
 * module installed so the native side registers the component; this is the JavaScript half only.
 */
export function registerExpoView(
  elementName: string,
  moduleName: string,
  options?: ExpoViewOptions,
): void {
  const viewName = options?.viewName;
  registerViewName(
    elementName,
    typeof viewName === 'object'
      ? {
          ios: expoViewName(moduleName, viewName.ios),
          android: expoViewName(moduleName, viewName.android),
        }
      : expoViewName(moduleName, viewName),
    options?.defaultProps,
    {
      textContent: options?.textContent,
      yieldsToComponents: options?.yieldsToComponents,
      fontNames: options?.fontNames,
    },
  );
  optional(() =>
    (
      require('expo') as { requireNativeView(module: string, view?: string): unknown }
    ).requireNativeView(
      moduleName,
      typeof viewName === 'object'
        ? currentPlatform() === 'android'
          ? viewName.android
          : viewName.ios
        : viewName,
    ),
  );
}

/**
 * The views worth knowing the names of, so an app does not have to look each one up.
 *
 * Names and defaults. Each view here also has a typed component or directive in this package
 * (`ExpoImage`, `ExpoBlur`, `ExpoVideo`, `Camera`, `AppleSignInButton`, `ExpoSymbol`, `ExpoGL`,
 * `ExpoGlass`, `ExpoGlassContainer`, `ExpoMeshGradient`, `ExpoLivePhoto`, and `MapView` for both
 * maps), whose inputs are the module's props: a template is checked against them, and a boolean
 * written as a bare attribute commits as true. Without it the element still commits, and takes
 * whatever it is given, so a bare boolean attribute reaches native as an empty string, which iOS,
 * Android and macOS each drop for a boolean prop.
 *
 * A module still has to be installed for its element to commit as anything: this is the
 * JavaScript half. An element whose native side is missing commits as `UnimplementedNativeView`.
 */
export const EXPO_VIEWS: Readonly<Record<string, [string, ExpoViewOptions?]>> = {
  /** `expo-image`. Takes `source` as a list, so a single `{uri}` is wrapped by the caller. */
  'expo-image': ['ExpoImage', { defaultProps: { contentFit: 'cover' } }],
  /**
   * `expo-blur`. The one thing CSS cannot express: a blur of what is *behind* a view. The view is
   * `ExpoBlurView` on the `ExpoBlur` module, as `expo-blur`'s own `NativeBlurModule` asks for it.
   */
  'expo-blur': [
    'ExpoBlur',
    { viewName: 'ExpoBlurView', defaultProps: { intensity: 50, tint: 'default' } },
  ],
  /**
   * `expo-video`. The player itself is a shared object the module hands out; this is its view,
   * which has another name on Android, as `expo-video`'s own `NativeVideoView` asks for it. Bind
   * `player` to the player's `id` (`videoPlayer`'s), not to the player.
   */
  'expo-video': ['ExpoVideo', { viewName: { ios: 'VideoView', android: 'SurfaceVideoView' } }],
  /**
   * `expo-camera`. Its module's first view, so its default: `ExpoCamera_CameraView` exists only on
   * iOS, after the Swift class, and commits as nothing on Android. `Camera` takes its pictures.
   */
  'expo-camera': ['ExpoCamera'],
  /** `expo-apple-authentication`: Apple's Sign in with Apple button. iOS only. */
  'apple-sign-in-button': ['ExpoAppleAuthentication'],
  /** `expo-symbols`: SF Symbols, iOS only, and the reason `icons` is not needed for them. */
  'expo-symbol': ['SymbolModule', { defaultProps: { type: 'monochrome' } }],
  /** `expo-gl`, whose context is reached through an event rather than a prop. */
  'expo-gl': ['ExpoGL'],
  /** `expo-glass-effect`: the iOS 26 material. Renders as a plain view where it is unavailable. */
  'expo-glass': ['ExpoGlassEffect', { viewName: 'GlassView' }],
  /** Glass views that merge into one another when they come within `spacing` points. */
  'expo-glass-container': ['ExpoGlassEffect', { viewName: 'GlassContainer' }],
  /** `expo-mesh-gradient`: the one gradient CSS cannot express, because it has no CSS spelling. */
  'expo-mesh-gradient': ['ExpoMeshGradient', { viewName: 'MeshGradientView' }],
  /** `expo-live-photo`, iOS only. */
  'expo-live-photo': ['ExpoLivePhoto', { viewName: 'LivePhotoView' }],
  /**
   * `expo-maps`, Google's on Android and Apple's on iOS: two modules, each with one view, so each
   * its module's default. `ExpoMaps` itself is the permissions module and has no view.
   * `MapView` (`<expo-map>`) types both as one element.
   */
  'expo-maps-google': ['ExpoGoogleMaps'],
  'expo-maps-apple': ['ExpoAppleMaps'],
};

/**
 * Register several of the known views by element name.
 *
 * ```ts
 * registerExpoViews('expo-image', 'expo-blur');
 * ```
 *
 * Named one at a time rather than all at once on purpose: registering a view for a module the app
 * has not installed produces an element that commits as nothing, and finding out at startup which
 * modules are present is not something JavaScript can do without importing them all.
 */
export function registerExpoViews(...elements: readonly (keyof typeof EXPO_VIEWS)[]): void {
  for (const element of elements) {
    const known = EXPO_VIEWS[element];
    if (!known) throw new Error(`[angular-native] no Expo view is known as '${element}'`);
    registerExpoView(element, known[0], known[1]);
  }
}
