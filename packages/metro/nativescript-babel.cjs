/**
 * The Babel config an app gets when it has `@nativescript/react-native` installed and no Babel
 * config of its own: Expo's, with the worklets plugin told that a name a worklet does not declare
 * is a global.
 *
 * By default the worklets plugin captures such a name into the worklet's closure, read on the
 * JavaScript thread as the worklet is created. NativeScript's classes are globals of the UI
 * runtime, and of the JavaScript one only once NativeScript is installed, which is after the
 * modules declaring the worklets have run: so `UILabel.new()` in a worklet fails as the app starts,
 * with `Property 'UILabel' doesn't exist`. `strictGlobal` leaves every undeclared name to be
 * looked up where the worklet runs.
 *
 * Found through `nativeScriptBabel` in `transformer.cjs`.
 */
const path = require('node:path');

module.exports = function nativeScriptBabelConfig(api) {
  // Reading the caller also keys Babel's cache on it, so this runs once per project root.
  const projectRoot = api.caller((caller) => caller?.projectRoot) ?? process.cwd();
  const from = { paths: [projectRoot] };
  const expo = path.dirname(require.resolve('expo/package.json', from));
  return {
    // The preset's own worklets plugin is off, so the one below is the only one.
    presets: [[require.resolve('babel-preset-expo', { paths: [expo] }), { worklets: false }]],
    plugins: [[require.resolve('react-native-worklets/plugin', from), { strictGlobal: true }]],
  };
};
