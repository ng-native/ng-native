import { Component, signal } from '@angular/core';
import { AppleSignInButton } from '../../expo/src/apple-sign-in-button.ts';
import { ExpoGlass, ExpoGlassContainer } from '../../expo/src/glass.ts';
import { ExpoSymbol } from '../../expo/src/symbol.ts';

/** Liquid Glass, SF Symbols and the Sign in with Apple button, as an app's templates use them. */
@Component({
  selector: 'x-expo-views',
  imports: [AppleSignInButton, ExpoGlass, ExpoGlassContainer, ExpoSymbol],
  template: `
    <expo-glass-container nativeID="container" spacing="12">
      <expo-glass nativeID="glass" glassEffectStyle="clear" tintColor="#ff000033" isInteractive />
    </expo-glass-container>
    <expo-glass nativeID="plain" />
    <expo-symbol nativeID="heart" name="heart.fill" [size]="32" tintColor="red" weight="bold" />
    <expo-symbol
      nativeID="palette"
      name="cloud.sun.fill"
      type="palette"
      [colors]="['#fff', '#fc0']"
      [animationSpec]="{ effect: { type: 'bounce' } }"
    />
    <expo-symbol nativeID="default" name="star" />
    <expo-symbol nativeID="unsized" name="star" [size]="unset" colors="red" />
    <expo-symbol nativeID="sized" [name]="symbol()" [size]="symbolSize()" scale="large" />
    <apple-sign-in-button nativeID="plain-apple" />
    <apple-sign-in-button
      nativeID="apple"
      buttonType="continue"
      buttonStyle="black"
      cornerRadius="8"
      (buttonPress)="presses.set(presses() + 1)"
    />
  `,
})
export class ExpoViewsFixture {
  readonly presses = signal(0);
  readonly symbol = signal('doc.text');
  readonly symbolSize = signal(17);
  readonly unset: number | undefined = undefined;
}
