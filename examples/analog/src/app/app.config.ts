import { withComponentInputBinding } from '@angular/router';
import { pageRoutes, provideContentFiles } from '@ng-native/analog';
import { provideNativeRouter, withLinkParent } from '@ng-native/router';
import { content } from './content.ts';
import { pages } from './pages.ts';
import { MarkdownPage } from './ui/markdown-page.ts';

/** The page a link opens on top of: a product on the list, a post on the blog, else the home page. */
function linkParent(url: string): string | null {
  const path = url.split(/[?#]/)[0]!;
  if (path === '/') return null;
  if (path.startsWith('/blog/')) return '/blog';
  return path.startsWith('/products/') ? '/products' : '/';
}

/**
 * Analog's routes for the pages, on a native stack, with each `.md` page drawn by `MarkdownPage`;
 * a product page's `[productId]` arrives as an input, and a link that launches the app opens with
 * the pages it sits under beneath it. The blog reads its posts from `src/content`.
 */
export const appConfig = {
  providers: [
    provideNativeRouter(
      pageRoutes(pages, { markdownPage: MarkdownPage }),
      withComponentInputBinding(),
      withLinkParent(linkParent),
    ),
    provideContentFiles(content),
  ],
};
