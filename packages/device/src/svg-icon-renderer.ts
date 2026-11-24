/**
 * What draws an icon's SVG markup as an image, for a place on iOS and Android that takes an image
 * and not a view: a `<native-tab>` icon and a `<native-button>` icon. Neither platform draws SVG
 * there, so the app provides a renderer, `SvgImages` from `@ng-native/icons`, through
 * `withSvgIcons` in `provideNativeRouter` or this token. The packages that draw an icon import no
 * renderer: drawing SVG is the icons package's, and it imports neither of them.
 */
import { InjectionToken, type ViewContainerRef } from '@angular/core';

/** Draws SVG markup as an image. `SvgImages` from `@ng-native/icons` is one. */
export interface SvgIconRenderer {
  /**
   * The markup drawn `size` points square, as an image source native can show, such as a
   * `{ uri, scale }`. It may draw the markup into a view it creates in `at`, which is on screen.
   * Null when it could not be drawn.
   */
  render(svg: string, size: number, at: ViewContainerRef): Promise<unknown>;
}

/**
 * The app's renderer, or null when it provides none:
 *
 * ```ts
 * providers: [{ provide: SVG_ICON_RENDERER, useClass: SvgImages }];
 * ```
 */
export const SVG_ICON_RENDERER = new InjectionToken<SvgIconRenderer | null>(
  'angular-native.svgIconRenderer',
  { factory: () => null },
);
