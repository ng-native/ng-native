import { Component, inject, signal, linkedSignal } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { ExpoGlass, ExpoGlassContainer, ExpoSymbol, liquidGlassAvailable } from '@ng-native/expo';
import {
  AppleAuthenticationScope,
  AppleSignIn,
  AppleSignInButton,
} from '@ng-native/expo/apple-sign-in';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * Liquid Glass, SF Symbols and Sign in with Apple: three native views from Expo modules, typed as
 * components and registered by name in main.ts. iOS only; elsewhere the glass is a plain view and
 * the rest render nothing.
 */
@Component({
  selector: 'x-native-views',
  imports: [
    AppleSignInButton,
    ExpoGlass,
    ExpoGlassContainer,
    ExpoSymbol,
    NativeHeader,
    ScrollView,
    Text,
    View,
  ],
  template: `
    <native-header title="Native views" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <text class="heading">Liquid Glass</text>
      <text class="body">{{ glassNote }}</text>
      <view class="backdrop">
        <expo-glass-container class="row" spacing="16">
          <expo-glass class="orb" isInteractive accessibilityLabel="Glass heart">
            <expo-symbol name="heart.fill" [size]="26" tintColor="#ff2d55" />
          </expo-glass>
          <expo-glass class="orb" glassEffectStyle="clear" accessibilityLabel="Clear glass star">
            <expo-symbol name="star.fill" [size]="26" tintColor="#ffcc00" />
          </expo-glass>
          <expo-glass class="orb" tintColor="#0a84ff55" accessibilityLabel="Tinted glass bolt">
            <expo-symbol name="bolt.fill" [size]="26" tintColor="#ffffff" />
          </expo-glass>
        </expo-glass-container>
      </view>

      <text class="heading">SF Symbols</text>
      <view class="row">
        <expo-symbol name="cloud.sun.fill" type="multicolor" [size]="44" />
        <expo-symbol
          name="cloud.sun.rain.fill"
          type="palette"
          [colors]="['#8e8e93', '#ffcc00', '#0a84ff']"
          [size]="44"
        />
        <expo-symbol
          name="bell.fill"
          [size]="44"
          tintColor="#ff9500"
          [animationSpec]="{ effect: { type: 'bounce' }, repeating: true }"
        />
        <expo-symbol name="gearshape.fill" [size]="44" weight="ultraLight" tintColor="#8e8e93" />
      </view>

      <text class="heading">Sign in with Apple</text>
      <text class="body" accessibilityLabel="Apple sign-in status">{{ status() }}</text>
      <apple-sign-in-button
        class="apple"
        buttonType="continue"
        buttonStyle="black"
        cornerRadius="12"
        accessibilityLabel="Continue with Apple"
        (buttonPress)="signIn()"
      />
    </scroll-view>
  `,
  styles: `
    .backdrop {
      padding: 24px;
      border-radius: 24px;
      background-image: linear-gradient(135deg, #5e5ce6, #ff375f);
    }
    .row {
      flex-direction: row;
      gap: 16px;
      align-items: center;
    }
    .orb {
      width: 64px;
      height: 64px;
      border-radius: 32px;
      align-items: center;
      justify-content: center;
    }
    .apple {
      height: 48px;
      align-self: stretch;
    }
  `,
})
export class NativeViewsPage {
  private readonly apple = inject(AppleSignIn);
  protected readonly page = page;
  protected readonly glassNote = liquidGlassAvailable()
    ? 'Rendered with Liquid Glass. Glass views within 16 points of each other merge.'
    : 'Liquid Glass is not available here, so the glass views render as plain views.';
  protected readonly status = linkedSignal<string>(() =>
    this.apple.available() ? 'Available.' : 'Not available on this device.',
  );

  protected async signIn(): Promise<void> {
    this.status.set('Signing in.');
    try {
      const credential = await this.apple.signIn({
        requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
      });
      this.status.set(credential ? 'Signed in as ' + credential.user + '.' : 'Cancelled.');
    } catch (error) {
      this.status.set('Failed: ' + String((error as Error)?.message ?? error));
    }
  }
}
