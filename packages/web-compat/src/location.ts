import { PlatformLocation } from '@angular/common';
import { Injectable } from '@angular/core';

/**
 * A location for an app with no router. A library that closes its overlays on navigation asks for
 * Angular's `Location`, whose own platform half reads `window.location` and `history`, which do
 * not exist here. This one is a single page that never navigates.
 *
 * The native router provides its own, and wins when it is listed after `provideWebCompat()`.
 */
@Injectable()
export class StillLocation extends PlatformLocation {
  readonly href = '/';
  readonly protocol = '';
  readonly hostname = '';
  readonly port = '';
  readonly pathname = '/';
  readonly search = '';
  readonly hash = '';

  getBaseHrefFromDOM(): string {
    return '/';
  }
  getState(): unknown {
    return null;
  }
  onPopState(): VoidFunction {
    return () => {};
  }
  onHashChange(): VoidFunction {
    return () => {};
  }
  replaceState(): void {}
  pushState(): void {}
  forward(): void {}
  back(): void {}
}
