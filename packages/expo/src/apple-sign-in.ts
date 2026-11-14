/**
 * `AppleSignIn`, bound to `expo-apple-authentication`: Sign in with Apple, which the App Store
 * requires of an app that offers another social sign-in. iOS, and macOS through the desktop host's
 * `NgNativeAppleAuthentication`, where `available()` is true only for an app signed with the Sign
 * in with Apple entitlement. Everywhere else, and without the module installed, `available()`
 * answers false and every call answers null.
 *
 * ```ts
 * import { AppleAuthenticationScope, AppleSignIn } from '@ng-native/expo/apple-sign-in';
 *
 * private readonly apple = inject(AppleSignIn);
 *
 * async signIn(): Promise<void> {
 *   const credential = await this.apple.signIn({
 *     requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
 *   });
 *   if (credential) await this.session.start(credential.identityToken);
 * }
 * ```
 *
 * The button Apple's guidelines ask for is `<apple-sign-in-button>`, in
 * `./apple-sign-in-button.ts`.
 *
 * A sign-in the user cancels answers null rather than throwing: closing the sheet is an ordinary
 * answer, not a failure, and every caller would otherwise have to tell `ERR_REQUEST_CANCELED` apart
 * from a real error itself.
 */
import { DestroyRef, InjectionToken, Service, inject, signal, type Signal } from '@angular/core';
import type {
  AppleAuthenticationButtonStyle as ExpoButtonStyle,
  AppleAuthenticationButtonType as ExpoButtonType,
  AppleAuthenticationCredential,
  AppleAuthenticationCredentialState as ExpoCredentialState,
  AppleAuthenticationScope as ExpoScope,
} from 'expo-apple-authentication';
import { coded, desktopHost } from './desktop-host.ts';
import { expoModule, present, asked } from './native.ts';

type Expo = typeof import('expo-apple-authentication');

/** The module's functions this service calls. The real module is one; a test provides a fake. */
export type NativeAppleAuthentication = Pick<
  Expo,
  | 'isAvailableAsync'
  | 'signInAsync'
  | 'refreshAsync'
  | 'signOutAsync'
  | 'getCredentialStateAsync'
  | 'formatFullName'
  | 'addRevokeListener'
>;

type Args<K extends keyof NativeAppleAuthentication> = Parameters<NativeAppleAuthentication[K]>;

/*
 * The module's enums, as plain numbers typed as the enums themselves. Importing an enum from the
 * module loads the module, which a test in Node cannot; these are the same values, so either is
 * accepted wherever the module's types are.
 */

/** What `signIn` asks the user to share. */
export const AppleAuthenticationScope = {
  FULL_NAME: 0,
  EMAIL: 1,
} as unknown as typeof ExpoScope;

/** What `credentialState` answers. */
export const AppleAuthenticationCredentialState = {
  REVOKED: 0,
  AUTHORIZED: 1,
  NOT_FOUND: 2,
  TRANSFERRED: 3,
} as unknown as typeof ExpoCredentialState;

/** The button's wording, as native takes it. `<apple-sign-in-button>` takes the names instead. */
export const AppleAuthenticationButtonType = {
  SIGN_IN: 0,
  CONTINUE: 1,
  SIGN_UP: 2,
} as unknown as typeof ExpoButtonType;

/** The button's colours, as native takes them. */
export const AppleAuthenticationButtonStyle = {
  WHITE: 0,
  WHITE_OUTLINE: 1,
  BLACK: 2,
} as unknown as typeof ExpoButtonStyle;

@Service()
export class AppleSignIn {
  /** Overridden in a test to sign in without Apple. */
  static readonly SOURCE = new InjectionToken<NativeAppleAuthentication | null>(
    'angular-native.appleSignInSource',
    {
      factory: () =>
        expoModule(
          'expo-apple-authentication',
          () => require('expo-apple-authentication') as Expo,
          { platforms: ['ios'], desktop: desktopAppleAuthentication },
        ),
    },
  );

  private readonly native = inject(AppleSignIn.SOURCE);
  private readonly revocations = signal(0);

  constructor() {
    const native = present(this.native);
    if (!native) return;
    // The user can revoke the app's access in Settings while it runs; the session it signed in
    // with is then no longer theirs to use.
    const subscription = native.addRevokeListener(() =>
      this.revocations.update((count) => count + 1),
    );
    inject(DestroyRef).onDestroy(() => subscription.remove());
  }

  /** How many times the user has revoked the app's Apple ID credential while it ran. */
  readonly revoked: Signal<number> = this.revocations.asReadonly();

  /**
   * Whether Sign in with Apple can be offered: iOS 13 and later, with the module installed. False
   * until the platform answers.
   */
  readonly available: Signal<boolean> = asked(() => present(this.native)?.isAvailableAsync())
    .answer;

  /**
   * Shows Apple's sign-in sheet. The name and email in the credential are only there the first
   * time a user signs in to the app, so store them then. Null when the user cancels, or without
   * the module.
   */
  async signIn(...options: Args<'signInAsync'>): Promise<AppleAuthenticationCredential | null> {
    if (!this.native) return null;
    try {
      return await this.native.signInAsync(...options);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED') return null;
      throw error;
    }
  }

  /** A fresh credential for a user already signed in. Null without the module. */
  async refresh(...options: Args<'refreshAsync'>): Promise<AppleAuthenticationCredential | null> {
    return (await this.native?.refreshAsync(...options)) ?? null;
  }

  /** Signs the user out with Apple. Null without the module. */
  async signOut(...options: Args<'signOutAsync'>): Promise<AppleAuthenticationCredential | null> {
    return (await this.native?.signOutAsync(...options)) ?? null;
  }

  /** Whether a user's credential is still authorised, for a check at launch. Null without the module. */
  async credentialState(user: string): Promise<ExpoCredentialState | null> {
    return (await this.native?.getCredentialStateAsync(user)) ?? null;
  }

  /** A credential's name, formatted for the user's locale. Empty without the module. */
  formatName(...name: Args<'formatFullName'>): string {
    return this.native?.formatFullName(...name) ?? '';
  }
}

/** What the desktop host's `NgNativeAppleAuthentication` answers: expo's native module. */
interface AppleAuthenticationHost {
  isAvailableAsync(): Promise<boolean>;
  requestAsync(options: object): Promise<AppleAuthenticationCredential>;
  getCredentialStateAsync(user: string): Promise<ExpoCredentialState>;
  formatFullName(name: object, style: string | null): string;
}

/** expo-apple-authentication's `requestedOperation`s. */
const LOGIN = 1;
const REFRESH = 2;
const LOGOUT = 3;

/**
 * expo-apple-authentication's functions over the desktop host's module, for macOS: what the
 * package's JavaScript adds to its native module (the operation each function asks for, and the
 * check that a sign-in's credential carries its tokens), with the host's `CODE: message`
 * rejections as errors with that `code`, and revocations from its events.
 */
function desktopAppleAuthentication(): NativeAppleAuthentication | null {
  const host = desktopHost<AppleAuthenticationHost>('NgNativeAppleAuthentication');
  if (!host) return null;
  const native = host.module;
  const request = async (options: object | undefined, operation: number, name: string) => {
    const credential = await coded(
      native.requestAsync({ ...options, requestedOperation: operation }),
    );
    if (
      operation !== LOGOUT &&
      (!credential.authorizationCode || !credential.identityToken || !credential.user)
    ) {
      throw Object.assign(
        new Error(`The credential returned by \`${name}\` is missing one or more required fields.`),
        { code: 'ERR_REQUEST_FAILED' },
      );
    }
    return credential;
  };
  return {
    isAvailableAsync: () => native.isAvailableAsync(),
    signInAsync: (options) => request(options, LOGIN, 'signInAsync'),
    refreshAsync: (options) => request(options, REFRESH, 'refreshAsync'),
    signOutAsync: (options) => request(options, LOGOUT, 'signOutAsync'),
    getCredentialStateAsync: (user) => coded(native.getCredentialStateAsync(user)),
    formatFullName: (name, style) => native.formatFullName(name, style ?? null),
    addRevokeListener: (listener) =>
      host.listen('ngNativeAppleAuthentication', (event) => {
        if ((event as { type?: unknown } | null)?.type === 'revoked') listener();
      }) as ReturnType<NativeAppleAuthentication['addRevokeListener']>,
  };
}

export {
  AppleSignInButton,
  type AppleButtonStyle,
  type AppleButtonType,
} from './apple-sign-in-button.ts';
