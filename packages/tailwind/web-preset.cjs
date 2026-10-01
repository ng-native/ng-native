/**
 * The web preset, for Tailwind 3 in a browser through `@ng-native/web`.
 *
 *   // tailwind.config.js, for the web build
 *   module.exports = {
 *     presets: [require('@ng-native/tailwind/web-preset.cjs')],
 *     content: ['./src/**\/*.{ts,html}'],
 *   };
 *
 * The Tailwind 3 counterpart of `web.css`, as `preset.cjs` is of `native.css`: `hover:` and
 * `focus-visible:` are the browser's own, the safe area and the hairline come from the browser,
 * and `font-mono` keeps Tailwind's stack. The platform and dark variants match the classes
 * `mount` keeps on the root under an app's `prefix` too. `tailwind-3-preset.cjs` builds both.
 */
const { tailwind3Preset } = require('./tailwind-3-preset.cjs');

module.exports = tailwind3Preset('web');
