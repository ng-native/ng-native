import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/**
 * Custom properties set on elements to another token, `var(--brand)`, read by a class through a
 * variable of the component's own, inside a wrapper that switches theme.
 */
@Component({
  imports: [Text, View],
  selector: 'token-chain',
  template: `
    <view nativeID="theme" [class.dark]="dark()" [style.--brand]="brand()">
      <view nativeID="bound" class="fill" [style.--fill-color]="'var(--brand)'">
        <text nativeID="inside" class="ink">A</text>
      </view>
      <view nativeID="static" class="fill" style="--fill-color: var(--brand)"></view>
      <view nativeID="literal" class="fill" [style.--fill-color]="'rgb(255, 0, 0)'"></view>
      <view
        nativeID="fallback"
        class="fill"
        [style.--fill-color]="'var(--missing, var(--brand))'"
      ></view>
      <view
        nativeID="written"
        class="fill"
        [style.--fill-color]="'var(--missing, rgb(0, 128, 0))'"
      ></view>
    </view>
  `,
})
export class TokenChain {
  readonly dark = signal(false);
  readonly brand = signal<string | null>(null);
}
