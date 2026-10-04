/**
 * The type of a `.md` import, for an app bundled with `withAngularNative`. Add it to the app's
 * `tsconfig.json`, as `"types": ["@ng-native/metro/markdown"]`, or reference it from a `.d.ts` of
 * the app's own: `/// <reference types="@ng-native/metro/markdown" />`.
 */
declare module '*.md' {
  const file: import('./markdown-file').MarkdownFile;
  export default file;
}
