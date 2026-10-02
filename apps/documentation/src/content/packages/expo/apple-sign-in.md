---
title: Sign in with Apple
summary: Apple's sign-in sheet and its approved button, with a canceled sheet answering null.
---

# Sign in with Apple

`AppleSignIn` wraps `expo-apple-authentication`: whether Sign in with Apple can be offered, the
sheet that signs the user in, and the checks an app makes afterwards. `<apple-sign-in-button>` is
Apple's own button for it. The App Store requires Sign in with Apple of an app that offers another
social sign-in. It is iOS only; elsewhere `available()` answers false.

## Install

```sh
npx expo install expo-apple-authentication
```

Turn the capability on in `app.json`, which adds the entitlement to the native project:

```json
{ "expo": { "ios": { "usesAppleSignIn": true } } }
```

```ts
import { AppleSignIn, AppleSignInButton } from '@ng-native/expo/apple-sign-in';
```

Register the button's view once at startup, with the other Expo views:

```ts
import { registerExpoViews } from '@ng-native/expo';

registerExpoViews('apple-sign-in-button');
```

## The smallest thing that works

```ts
import { Component, inject, signal } from '@angular/core';
import {
  AppleAuthenticationScope,
  AppleSignIn,
  AppleSignInButton,
} from '@ng-native/expo/apple-sign-in';

@Component({
  selector: 'app-sign-in',
  imports: [AppleSignInButton],
  template: `
    @if (offered()) {
      <apple-sign-in-button
        class="h-12 w-full"
        buttonType="continue"
        cornerRadius="12"
        (buttonPress)="signIn()"
      />
    }
  `,
})
export class SignIn {
  private readonly apple = inject(AppleSignIn);
  protected readonly offered = signal(false);

  constructor() {
    void this.apple.available().then((available) => this.offered.set(available));
  }

  protected async signIn(): Promise<void> {
    const credential = await this.apple.signIn({
      requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
    });
    if (credential) this.startSession(credential.identityToken);
  }

  private startSession(token: string | null): void {}
}
```

## Signing in

- **`available()`** resolves to whether the sheet can be shown: iOS 13 and later. Show the button
  only when it is true.
- **`signIn(options)`** shows Apple's sheet and resolves to the credential: a stable `user`
  identifier, an `identityToken` for your server to verify, and - the first time only - the
  user's name and email. Store those then; Apple does not send them again. A sheet the user
  closes resolves to null; any other failure rejects.
- **`refresh(options)`** and **`signOut(options)`** make the same request for a user already
  signed in.
- **`credentialState(user)`** resolves to whether a user's credential is still authorized, for a
  check at launch: `AppleAuthenticationCredentialState.AUTHORIZED`, `REVOKED`, `NOT_FOUND` or
  `TRANSFERRED`.
- **`formatName(fullName, style)`** formats the credential's name for the user's locale.
- **`revoked`** is a signal counting the times the user revoked the app's access in Settings while
  it ran. The session it signed in with is no longer theirs; sign them out when it changes.

`AppleAuthenticationScope`, `AppleAuthenticationCredentialState`, `AppleAuthenticationButtonType`
and `AppleAuthenticationButtonStyle` are the module's own enums, exported here as the same values so
code that uses them runs in a test, where the module cannot load.

## The button

`<apple-sign-in-button>` is `ASAuthorizationAppleIDButton`, which Apple's guidelines approve as it
is: its wording, logo and colors are the system's, localized and accessible.

- **`buttonType`** - `sign-in` (the default), `continue` or `sign-up`.
- **`buttonStyle`** - `black` (the default), `white`, or `white-outline` for a white background.
- **`cornerRadius`** - in points.
- **`(buttonPress)`** - the tap. Start `signIn()` here.

It needs a width and a height to show. Its color and corners come from `buttonStyle` and
`cornerRadius`; a CSS background or border radius does not apply to it.

## Without the module

On iOS, a missing `expo-apple-authentication` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when `AppleSignIn` first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On Android and the web, and in a test that provides no fake, `available()` resolves to false,
`signIn()`, `refresh()`, `signOut()` and `credentialState()` resolve to null, and `formatName()`
returns an empty string.

## Reference

<!-- api: AppleSignIn -->
