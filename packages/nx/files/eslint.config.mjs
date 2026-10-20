import ngNative from '@ng-native/eslint-plugin';

// The DOM events, HTML controls and browser APIs that compile but do nothing on a device. See
// https://ng-native.com/packages/eslint-plugin for each rule.
export default [
  { ignores: ['.expo/', 'ios/', 'android/', 'dist/'] },
  ...ngNative.configs.recommended,
];
