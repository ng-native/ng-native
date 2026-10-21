/**
 * Opt-in DOM compatibility: engine nodes that answer to the members a component library written
 * for the browser calls. Core knows nothing of it; it is built on `extendNodes` and
 * `extendRenderer`, and nothing is added until `provideWebCompat()` is called.
 */
export { provideWebCompat, type WebCompatOptions } from './provide-web-compat.ts';
export type { FrameLoader, FrameResponse } from './frame.ts';
export type { FrameMode } from './frame-view.ts';
export { provideBrowserPlatformId } from './browser-platform-id.ts';
export { FILE_PICKER, type FilePicker } from './file-input.ts';
