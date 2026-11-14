/**
 * `<apple-sign-in-button>`: Apple's own Sign in with Apple button, `ASAuthorizationAppleIDButton`,
 * from `expo-apple-authentication`. Apple's guidelines allow a custom button only if it follows
 * their branding rules; this one is approved, localised and accessible as it is.
 *
 * Registered with `registerExpoViews('apple-sign-in-button')`, like the other Expo views. It needs
 * a width and a height to show, and its colour and corners come from `buttonStyle` and
 * `cornerRadius`, not from CSS. Show it only where `AppleSignIn.available()` is true: on iOS,
 * and on macOS in an app signed with the Sign in with Apple entitlement.
 *
 * ```html
 * <apple-sign-in-button
 *   class="h-12 w-full"
 *   buttonType="continue"
 *   buttonStyle="black"
 *   cornerRadius="12"
 *   (buttonPress)="signIn()"
 * />
 * ```
 */
import { Component, computed, input, output } from '@angular/core';
import { optionalNumber } from './transforms.ts';

export type AppleButtonType = 'sign-in' | 'continue' | 'sign-up';
export type AppleButtonStyle = 'white' | 'white-outline' | 'black';

/** Native takes both as the module's enum values. */
const TYPES: Record<AppleButtonType, number> = { 'sign-in': 0, continue: 1, 'sign-up': 2 };
const STYLES: Record<AppleButtonStyle, number> = { white: 0, 'white-outline': 1, black: 2 };

@Component({
  selector: 'apple-sign-in-button',
  template: '',
  host: {
    '[buttonType]': 'nativeType()',
    '[buttonStyle]': 'nativeStyle()',
    '[cornerRadius]': 'cornerRadius()',
  },
})
export class AppleSignInButton {
  /** The button's wording: "Sign in with Apple", "Continue with Apple", "Sign up with Apple". */
  readonly buttonType = input<AppleButtonType>('sign-in');
  /** Black on a light background, white or white with an outline on a dark one. */
  readonly buttonStyle = input<AppleButtonStyle>('black');
  readonly cornerRadius = input<number>(undefined, { transform: optionalNumber });
  /** The button was tapped: start `AppleSignIn.signIn()` here. */
  readonly buttonPress = output<void>();

  protected readonly nativeType = computed(() => TYPES[this.buttonType()]);
  protected readonly nativeStyle = computed(() => STYLES[this.buttonStyle()]);
}
