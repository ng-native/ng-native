/**
 * `Biometrics`, bound to `expo-local-authentication`.
 *
 * ```ts
 * private readonly biometrics = inject(Biometrics);
 * const { success } = await this.biometrics.authenticate('Unlock your wallet');
 * ```
 *
 * Face ID needs `NSFaceIDUsageDescription` in the app config, or iOS ends the app the first time
 * it is asked for; `expo-local-authentication`'s config plugin writes it.
 */
import { InjectionToken, Service, inject } from '@angular/core';
import { expoModule, present } from './native.ts';

export type BiometricKind = 'fingerprint' | 'face' | 'iris';

/** Expo's `AuthenticationType` enum, whose values are these numbers. */
const KINDS: Record<number, BiometricKind> = { 1: 'fingerprint', 2: 'face', 3: 'iris' };

/** Passed, or the platform's reason it did not: `user_cancel`, `lockout`, `not_enrolled`... */
export type AuthenticationResult = { success: true } | { success: false; error: string };

export type AuthenticateOptions = Omit<
  import('expo-local-authentication').LocalAuthenticationOptions,
  'promptMessage'
>;

/** The slice of `expo-local-authentication` this needs. */
export interface NativeBiometrics {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  supportedAuthenticationTypesAsync(): Promise<number[]>;
  authenticateAsync(
    options?: import('expo-local-authentication').LocalAuthenticationOptions,
  ): Promise<AuthenticationResult>;
}

@Service()
export class Biometrics {
  /** Overridden in a test to pass or fail without a face. */
  static readonly SOURCE = new InjectionToken<NativeBiometrics | null>(
    'angular-native.biometricsSource',
    {
      factory: () =>
        expoModule(
          'expo-local-authentication',
          () => require('expo-local-authentication') as NativeBiometrics,
        ) ?? null,
    },
  );

  private readonly native = inject(Biometrics.SOURCE);

  /** Whether there is a sensor and something enrolled on it: whether asking can succeed. */
  async available(): Promise<boolean> {
    const native = present(this.native);
    if (!native) return false;
    const [hardware, enrolled] = await Promise.all([
      native.hasHardwareAsync(),
      native.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  }

  /** The kinds the device has, for a button that says "Use Face ID" rather than "Use biometrics". */
  async kinds(): Promise<BiometricKind[]> {
    const types = (await this.native?.supportedAuthenticationTypesAsync()) ?? [];
    return types.flatMap((type) => KINDS[type] ?? []);
  }

  /**
   * Show the system prompt. Without the module this fails rather than passes: a lock that opens
   * when its sensor is missing is not a lock.
   */
  async authenticate(
    message: string,
    options: AuthenticateOptions = {},
  ): Promise<AuthenticationResult> {
    if (!this.native) return { success: false, error: 'not_available' };
    return this.native.authenticateAsync({ promptMessage: message, ...options });
  }
}
