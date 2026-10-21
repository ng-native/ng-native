import { PLATFORM_ID, type Provider } from '@angular/core';

/**
 * Angular's platform id as a browser's, for the components under the one given this. A library
 * written for a browser asks the id before it opens an overlay or measures, and does neither on
 * any other platform. Given to the component or the route of such a library's page and not to
 * the app, whose own code and the framework's read the id to know they are on a device.
 *
 * ```ts
 * @Component({ providers: [provideBrowserPlatformId()], ... })
 * export class SettingsPage {}
 * ```
 */
export function provideBrowserPlatformId(): Provider {
  return { provide: PLATFORM_ID, useValue: 'browser' };
}
