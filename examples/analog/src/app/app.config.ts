import { withComponentInputBinding } from '@angular/router';
import { pageRoutes } from '@ng-native/analog';
import { provideNativeRouter, withLinkParent } from '@ng-native/router';
import { pages } from './pages.ts';

/** The page a link opens on top of: a product on the list, and anything else on the home page. */
function linkParent(url: string): string | null {
  const path = url.split(/[?#]/)[0]!;
  if (path === '/') return null;
  return path.startsWith('/products/') ? '/products' : '/';
}

/**
 * Analog's routes for the pages, on a native stack; a product page's `[productId]` arrives as an
 * input, and a link that launches the app opens with the pages it sits under beneath it.
 */
export const appConfig = {
  providers: [
    provideNativeRouter(pageRoutes(pages), withComponentInputBinding(), withLinkParent(linkParent)),
  ],
};
