/**
 * How a `<native-tab>` icon written as SVG markup is drawn. Neither platform's tab bar draws SVG,
 * so the markup is drawn once by a renderer the app provides, `withSvgIcons(SvgImages)` with
 * `SvgImages` from `@ng-native/icons`, and the image it gives back is what native shows. The
 * router imports no renderer: drawing SVG is the icons package's, and it imports no router.
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

/** The app's renderer, or null when it provides none. */
export const SVG_ICON_RENDERER = new InjectionToken<SvgIconRenderer | null>(
  'angular-native.svgIconRenderer',
  { factory: () => null },
);

/**
 * Where a tab's SVG icon is drawn: beside the tabs outlet, which is on screen. A tab that is not
 * selected is not, and Android draws nothing that is off screen.
 */
export const SVG_ICON_HOST = new InjectionToken<ViewContainerRef>('angular-native.svgIconHost');
