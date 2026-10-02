---
title: Browser
summary: An in-app browser, and a sign-in session through expo-web-browser.
---

# Browser

`Browser` wraps `expo-web-browser`: a page shown in an in-app browser, and a sign-in flow through
the system's own authentication session.

## Install

```sh
npx expo install expo-web-browser
```

```ts
import { Browser } from '@ng-native/expo/browser';
```

## The smallest thing that works

```ts
import { Component, inject } from '@angular/core';
import { Browser } from '@ng-native/expo/browser';

@Component({
  selector: 'app-sign-in',
  template: '<pressable (press)="signIn()"><text>Sign in</text></pressable>',
})
export class SignIn {
  private readonly browser = inject(Browser);

  protected async signIn(): Promise<void> {
    const returned = await this.browser.signIn(
      'https://id.example.com/authorize?client_id=...&redirect_uri=myapp://signed-in',
      'myapp://signed-in',
    );
    if (returned) {
      const code = new URL(returned).searchParams.get('code');
    }
  }
}
```

## Opening a page and signing in

- **`open(url)`** shows any page in the in-app browser - `SFSafariViewController` on iOS, a Custom
  Tab on Android - and resolves when the person closes it. Use it for anything that is not a
  sign-in: a privacy policy, a receipt, an external link.
- **`signIn(url, redirectUrl)`** opens the system's _authentication_ session instead -
  `ASWebAuthenticationSession` on iOS, a Custom Tab on Android - which shares the browser's cookies
  (so an existing session is picked up) and closes itself when the page redirects to `redirectUrl`.
  It resolves to that URL, with its `code` or `token` in the query string, ready for the app to
  exchange - or to **null** if the person closed it first.

As of iOS 11, `SFSafariViewController` no longer shares cookies with Safari - `signIn()`'s
`ASWebAuthenticationSession` does, which is why sign-in uses it and `open()` does not.

## The full OAuth flow, with PKCE

`signIn()` covers a redirect-and-read-the-URL flow. For the full flow - PKCE, a provider's
discovery document - `expo-auth-session`'s `AuthRequest` is a plain class that needs no React, and
its `promptAsync` opens this same session:

```ts
import { AuthRequest, makeRedirectUri, exchangeCodeAsync } from 'expo-auth-session';

const discovery = { authorizationEndpoint: '...', tokenEndpoint: '...' };
const request = new AuthRequest({
  clientId: 'my-client',
  scopes: ['openid', 'profile'],
  redirectUri: makeRedirectUri({ scheme: 'myapp' }),
});
const result = await request.promptAsync(discovery);
if (result.type === 'success') {
  const tokens = await exchangeCodeAsync(
    {
      clientId: 'my-client',
      code: result.params['code']!,
      redirectUri: request.redirectUri,
      extraParams: { code_verifier: request.codeVerifier! },
    },
    discovery,
  );
}
```

`expo-auth-session` is a separate package (`npx expo install expo-auth-session`); `Browser` does
not depend on it.

## Without the module

On iOS and Android, a missing `expo-web-browser` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `open()` and `signIn()` resolve without opening
anything - `signIn()` resolves to null, as though the person had closed the page immediately.

## Reference

<!-- api: Browser -->
