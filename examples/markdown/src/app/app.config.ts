import { withComponentInputBinding } from '@angular/router';
import { fileRoutes, provideNativeRouter, withLinkParent } from '@ng-native/router';
import { pages } from './pages.ts';
import { MarkdownPage } from './ui/markdown-page.ts';

/**
 * The routes are the files in `pages/`, each `.md` page drawn by `MarkdownPage`; a note's `[slug]`
 * arrives as an input, and a link that launches the app on a note or a screen opens with the
 * library beneath it.
 */
export const appConfig = {
  providers: [
    provideNativeRouter(
      fileRoutes(pages, { markdownPage: MarkdownPage }),
      withComponentInputBinding(),
      withLinkParent((url) => (url === '/' ? null : '/')),
    ),
  ],
};
