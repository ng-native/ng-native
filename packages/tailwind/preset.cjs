/**
 * The native preset, for Tailwind 3.
 *
 *   // tailwind.config.js
 *   module.exports = {
 *     presets: [require('@ng-native/tailwind/preset.cjs')],
 *     content: ['./src/**\/*.{ts,html}'],
 *   };
 *
 * `web-preset.cjs` is the counterpart for a browser, and `tailwind-3-preset.cjs` builds both.
 */
const { tailwind3Preset } = require('./tailwind-3-preset.cjs');

module.exports = tailwind3Preset('native');
