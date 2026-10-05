import type { PageContext } from '@ng-native/router';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp, mode?: 'lazy'): PageContext;
};

/**
 * Every page in `pages/`, for `fileRoutes`: the `.page.ts` components and the `.md` pages. Metro
 * finds them as it bundles, and each one loads the first time it is opened. The tests, which have
 * no `require.context`, replace this module with an `import.meta.glob` of the same files.
 */
export const pages = require.context('./pages', true, /\.(page\.ts|md)$/, 'lazy');
