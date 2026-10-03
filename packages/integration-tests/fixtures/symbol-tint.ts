import { Component, signal } from '@angular/core';
import { ExpoSymbol } from '../../expo/src/symbol.ts';
import { View } from '../../components/src/view.ts';

/** A symbol that takes its colour from a token, through a stylesheet. */
@Component({
  selector: 'x-symbol-tint',
  imports: [ExpoSymbol, View],
  template: `
    <view [style.--accent]="accent()">
      <expo-symbol nativeID="tinted" class="tinted" name="heart.fill" />
      <expo-symbol nativeID="coloured" class="coloured" name="heart.fill" />
      <expo-symbol nativeID="input" class="tinted" name="heart.fill" tintColor="rgb(9, 9, 9)" />
    </view>
  `,
  styles: `
    .tinted {
      tint-color: var(--accent);
    }
    .coloured {
      color: var(--accent);
    }
  `,
})
export class SymbolTint {
  readonly accent = signal('rgb(1, 2, 3)');
}
