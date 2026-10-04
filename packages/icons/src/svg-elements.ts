/**
 * react-native-svg, driven directly.
 *
 * The same arrangement as react-native-screens in the router: the native side is a set of
 * codegen'd Fabric components, and their React wrappers are unreachable, so the engine is taught
 * the element names and the shapes are created with `createElement`. The app installs
 * `react-native-svg` for the native half; none of its JavaScript is imported.
 *
 * No decorators here: tests import this at runtime.
 */
import { nativePlatform, registerViewName } from '@ng-native/fabric';

/**
 * Element name -> Fabric component. Lowercase, because the compiler drops a template with a
 * capitalized element name, and prefixed, because `path` and
 * `line` are words an app might reasonably want for a component of its own.
 *
 * The root is the one that differs per platform: iOS draws into `RNSVGSvgView`, Android into
 * `RNSVGSvgViewAndroid`, and react-native-svg keeps them as separate specs because their props
 * are not the same.
 */
const SVG_VIEW_NAMES: Record<string, string> = {
  'svg-g': 'RNSVGGroup',
  'svg-path': 'RNSVGPath',
  'svg-circle': 'RNSVGCircle',
  'svg-ellipse': 'RNSVGEllipse',
  'svg-rect': 'RNSVGRect',
  'svg-line': 'RNSVGLine',
  'svg-defs': 'RNSVGDefs',
  'svg-linear-gradient': 'RNSVGLinearGradient',
  'svg-radial-gradient': 'RNSVGRadialGradient',
  'svg-text': 'RNSVGText',
  'svg-tspan': 'RNSVGTSpan',
};

let registered = false;

/**
 * Teach the engine the shape elements and `ng-icon`, `NgIcon`'s own host, as the root. Called by
 * `NgIcon`, so importing it is the whole setup - the same lesson as `AnimatedStyle`, which stopped
 * needing a bootstrap provider for the same reason.
 *
 * A name the native side does not know renders as `UnimplementedNativeView` rather than erroring,
 * so an app that has not installed `react-native-svg` sees blank boxes where its icons were.
 */
export function registerSvgComponents(): void {
  if (registered) return;
  registered = true;
  registerViewName(
    'ng-icon',
    nativePlatform() === 'android' ? 'RNSVGSvgViewAndroid' : 'RNSVGSvgView',
  );
  for (const [element, viewName] of Object.entries(SVG_VIEW_NAMES)) {
    registerViewName(element, viewName);
  }
}
