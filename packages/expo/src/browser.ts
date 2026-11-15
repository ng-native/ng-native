/**
 * `Browser`, bound to `expo-web-browser`: a page in an in-app browser, and a sign-in through one.
 *
 * ```ts
 * private readonly browser = inject(Browser);
 * const returned = await this.browser.signIn(authorizeUrl, 'myapp://signed-in');
 * ```
 *
 * `signIn` opens the system's authentication session (`ASWebAuthenticationSession` on iOS, a
 * Custom Tab on Android), which shares the browser's cookies and closes itself when the page
 * redirects to the app's URL. What comes back is that URL, with its `code` or `token`, for the app
 * to exchange. For the full OAuth flow with PKCE, `expo-auth-session`'s `AuthRequest` is a plain
 * class that needs no React; its `promptAsync` opens this same session.
 */
import { InjectionToken, Service, inject, type Signal } from '@angular/core';
import { expoModule, presence } from './native.ts';

type Expo = typeof import('expo-web-browser');

/** The slice of `expo-web-browser` this needs. */
export interface NativeBrowser {
  openBrowserAsync(url: string): Promise<{ type: string }>;
  openAuthSessionAsync(
    url: string,
    redirectUrl?: string | null,
  ): Promise<{ type: 'success'; url: string } | { type: string }>;
}

@Service()
export class Browser {
  /** Overridden in a test to sign in without a browser. */
  static readonly SOURCE = new InjectionToken<NativeBrowser | null>(
    'angular-native.browserSource',
    {
      factory: () =>
        expoModule('expo-web-browser', () => require('expo-web-browser') as Expo) ?? null,
    },
  );

  private readonly native = inject(Browser.SOURCE);

  /** Whether the module is here. False where the service is absent, and every call is inert. */
  readonly available: Signal<boolean> = presence(this.native);

  /** Open a page in the in-app browser. Resolves when it is closed. */
  async open(url: string): Promise<void> {
    await this.native?.openBrowserAsync(url);
  }

  /**
   * Open a sign-in page, and resolve to the URL it redirected back to - or null if they closed it
   * first.
   */
  async signIn(url: string, redirectUrl: string): Promise<string | null> {
    const result = await this.native?.openAuthSessionAsync(url, redirectUrl);
    return result?.type === 'success' && 'url' in result ? result.url : null;
  }
}
