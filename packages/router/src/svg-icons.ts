/**
 * How a `<native-tab>` icon written as SVG markup is drawn. Neither platform's tab bar draws SVG,
 * so the markup is drawn once by a renderer the app provides, `withSvgIcons(SvgImages)` with
 * `SvgImages` from `@ng-native/icons`, and the image it gives back is what native shows. The
 * renderer's token is `@ng-native/device`'s, which `<native-button>` reads too.
 */
import { InjectionToken, type ViewContainerRef } from '@angular/core';

export { SVG_ICON_RENDERER, type SvgIconRenderer } from '@ng-native/device';

/**
 * Where a tab's SVG icon is drawn: beside the tabs outlet, which is on screen. A tab that is not
 * selected is not, and Android draws nothing that is off screen.
 */
export const SVG_ICON_HOST = new InjectionToken<ViewContainerRef>('angular-native.svgIconHost');
