import { Component, signal } from '@angular/core';
import { ExpoSymbol } from '../../expo/src/symbol.ts';
import { View } from '../../components/src/view.ts';

/** Symbols tinted by every form of colour value, from a stylesheet and from a bound style. */
@Component({
  selector: 'x-symbol-tint-values',
  imports: [ExpoSymbol, View],
  template: `
    <view [style.--blue-100]="blue()">
      <expo-symbol nativeID="system" class="system" name="star" />
      <expo-symbol nativeID="relative" class="relative" name="star" />
      <expo-symbol nativeID="mixed" class="mixed" name="star" />
      <expo-symbol nativeID="bound" name="star" [style.tint-color]="mix" />
    </view>
  `,
  styles: `
    .system {
      tint-color: platform-color(link);
    }
    .relative {
      tint-color: rgb(from var(--blue-100) r g b / 0.85);
    }
    .mixed {
      tint-color: color-mix(in srgb, var(--blue-100) 85%, transparent);
    }
  `,
})
export class SymbolTintValues {
  readonly blue = signal('rgb(0, 0, 255)');
  protected readonly mix = 'color-mix(in srgb, var(--blue-100) 85%, transparent)';
}
