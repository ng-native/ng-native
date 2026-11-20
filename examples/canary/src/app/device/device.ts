import { Component, computed, inject } from '@angular/core';
import {
  Accessibility,
  AppState,
  ColorScheme,
  DeepLinks,
  Keyboard,
  SafeArea,
  Screen,
} from '@ng-native/device';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { PixelRatio } from 'react-native';
import { page } from '../screen-styles.ts';

/**
 * What the platform says about itself, as signals.
 *
 * Nothing is provided here or in `main.ts`: each service declares its own factory, so injecting
 * it is the whole setup. Rotate the simulator, switch the system theme, background the app or
 * turn on Reduce Motion and every line below follows without a binding being touched.
 *
 * The text field is the keyboard's proof: `keyboard-avoiding-view` moves the content clear of it,
 * and the readout beside it is the same subscription the layout is using.
 */
@Component({
  selector: 'x-device',
  imports: [KeyboardAvoidingView, NativeHeader, Pressable, ScrollView, Text, TextInput],
  template: `
    <native-header title="Device" />
    <keyboard-avoiding-view class="screen" [keyboardVerticalOffset]="100">
      <scroll-view class="screen" [contentContainerStyle]="page.content">
        <text class="hint">
          Every value below is a signal over a platform subscription. Rotate the device, switch the
          theme, or turn on Reduce Motion and they follow.
        </text>

        <text class="heading" role="heading" aria-level="2">Screen</text>
        <text class="body">
          {{ screen.window().width }} x {{ screen.window().height }}, {{ screen.orientation() }},
          {{ scale() }} pixels a point
        </text>
        <text class="hint">
          The same numbers the engine answers media queries with. Reduced motion is
          {{ accessibility.reduceMotion() ? 'on' : 'off' }}, and @media (prefers-reduced-motion:
          reduce) reads it too.
        </text>

        <text class="heading" role="heading" aria-level="2">Safe area</text>
        <text class="body">
          top {{ insets().top }}, bottom {{ insets().bottom }}, left {{ insets().left }}, right
          {{ insets().right }}
        </text>
        <text class="hint">
          Measured by the provider at the app's root. A layout wanting the space usually wants
          &lt;safe-area-view&gt; instead, which applies it natively.
        </text>

        <text class="heading" role="heading" aria-level="2">Appearance and state</text>
        <text class="body">{{ colors.current() }} theme, app is {{ app.current() }}</text>

        <text class="heading" role="heading" aria-level="2">Accessibility</text>
        <text class="body">
          screen reader {{ on(accessibility.screenReader()) }}, reduce motion
          {{ on(accessibility.reduceMotion()) }}, bold text {{ on(accessibility.boldText()) }}
        </text>
        <pressable
          class="card"
          role="button"
          [accessibilityActions]="announceActions"
          (accessibilityAction)="announceAgain()"
          (press)="announce()"
        >
          <text class="button-label">Announce to a screen reader</text>
        </pressable>

        <text class="heading" role="heading" aria-level="2">Keyboard</text>
        <text class="body">
          {{ keyboard.visible() ? keyboard.height() + 'pt tall' : 'hidden' }}
        </text>
        <text-input
          class="field"
          placeholder="Tap here to raise the keyboard"
          placeholderTextColor="#6c6c78"
        />
        <pressable class="card" role="button" (press)="keyboard.dismiss()">
          <text class="button-label">Dismiss it</text>
        </pressable>

        <text class="heading" role="heading" aria-level="2">Links</text>
        <pressable class="card" role="button" (press)="openSite()">
          <text class="button-label">Open angular.dev</text>
        </pressable>
        <text class="hint">
          The other half of deep linking: this app handed a url to whatever handles it.
        </text>
      </scroll-view>
    </keyboard-avoiding-view>
  `,
})
export class DevicePage {
  protected readonly accessibility = inject(Accessibility);
  protected readonly app = inject(AppState);
  protected readonly colors = inject(ColorScheme);
  protected readonly keyboard = inject(Keyboard);
  protected readonly screen = inject(Screen);
  protected readonly insets = inject(SafeArea).insets;
  private readonly links = inject(DeepLinks);

  protected readonly page = page;

  /** PixelRatio, read again on each `Dimensions` change, which a new scale is. */
  protected readonly scale = computed(() => {
    this.screen.display();
    return Math.round(PixelRatio.get() * 1000) / 1000;
  });

  protected on(value: boolean): string {
    return value ? 'on' : 'off';
  }

  protected announce(): void {
    this.accessibility.announce('Angular Native says hello');
  }

  /** A custom action on the same button, which a screen reader lists beside its press. */
  protected readonly announceActions = [{ name: 'repeat', label: 'Announce again' }];

  protected announceAgain(): void {
    this.accessibility.announce('Angular Native says hello again');
  }

  protected openSite(): void {
    this.links.open('https://angular.dev');
  }
}
