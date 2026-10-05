/**
 * Analog's file-based pages, routed by `@analogjs/router` on a native stack, and the content files
 * `@analogjs/content` reads, from `src/content`. The Metro half is `@ng-native/analog/metro`.
 *
 * A Markdown page is the one `@ng-native/router`'s `fileRoutes` routes, so its `injectMarkdownPage`
 * is the router's, and one `markdownPage` component draws a page under either.
 */
export { pageRoutes, type PageFiles, type PageRoutesOptions } from './page-routes.ts';
export { injectMarkdownPage, type MarkdownPageFile, type PageContext } from '@ng-native/router';
export {
  contentFileResource,
  contentFilesResource,
  injectContent,
  injectContentFiles,
  provideContentFiles,
  type ContentContext,
  type ContentFile,
  type ContentModules,
  type ContentParam,
  type ContentToken,
  type InjectContentFilesFilterFunction,
  type MarkdownModule,
  type TableOfContentItem,
} from './content.ts';
