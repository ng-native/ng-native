// Expo's fingerprint of the canary's native half, which CI keeps a built app under
// (scripts/ios-app.mjs, scripts/android-apk.mjs). The npm scripts are JavaScript's business, not
// the native build's: left in, editing one rebuilds the app and compares every screenshot.
/** @type {import('@expo/fingerprint').Config} */
module.exports = { sourceSkips: ['PackageJsonScriptsAll'] };
