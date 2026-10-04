import type { ContentContext } from '@ng-native/analog';

declare const require: {
  context(directory: string, recursive: boolean, filter: RegExp): ContentContext;
};

/**
 * Every Markdown file in `src/content`, for `provideContentFiles`. Metro makes each one
 * `{ attributes, content, tokens }` as it bundles. The tests, which have no `require.context`,
 * replace this module with an eager `import.meta.glob` of the same files.
 */
export const content = require.context('../content', true, /\.md$/);
