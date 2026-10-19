/**
 * Opt-in DOM compatibility: engine nodes that answer to the members a component library written
 * for the browser calls. Core knows nothing of it; it is built on `extendNodes` and
 * `extendRenderer`, and nothing is added until `provideWebCompat()` is called.
 */
export { provideWebCompat } from './provide-web-compat.ts';
export { provideBrowserPlatformId } from './browser-platform-id.ts';
