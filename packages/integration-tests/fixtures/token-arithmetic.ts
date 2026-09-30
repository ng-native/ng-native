import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

/**
 * Custom properties set on elements to a value with a `var()` inside it, `calc(var(--gap) * 2)`
 * or `hsl(var(--hue) 100% 50%)`, bound and written in a style attribute, read by a class.
 */
@Component({
  imports: [View],
  selector: 'token-arithmetic',
  template: `
    <view nativeID="theme" [class.dark]="dark()" [style.--gap]="gap()">
      <view nativeID="bound-calc" class="sized" [style.--size]="'calc(var(--gap) * 2)'"></view>
      <view nativeID="static-calc" class="sized" style="--size: calc(var(--gap) * 2)"></view>
      <view nativeID="bound-hsl" class="fill" [style.--fill]="'hsl(var(--hue) 100% 50%)'"></view>
      <view nativeID="static-hsl" class="fill" style="--fill: hsl(var(--hue) 100% 50%)"></view>
      <view nativeID="bound-rgb" class="fill" [style.--fill]="'rgba(var(--rgb), 0.5)'"></view>
      <view nativeID="static-rgb" class="fill" style="--fill: rgba(var(--rgb), 0.5)"></view>
    </view>
  `,
})
export class TokenArithmetic {
  readonly dark = signal(false);
  readonly gap = signal<string | null>(null);
}
