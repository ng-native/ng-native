import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** Ordinary declarations bound as styles whose values read tokens, as a stylesheet's can. */
@Component({
  selector: 'x-bound-vars',
  imports: [Text, View],
  template: `
    <view testID="card" [style.background-color]="'var(--surface)'"></view>
    <view testID="themed" [style.--surface]="surface()">
      <view testID="inner" [style.background-color]="'var(--surface)'" [style.width]="'var(--w)'">
      </view>
    </view>
    <view testID="fallback" [style.background-color]="'var(--missing, rgb(7, 8, 9))'"></view>
    <view testID="chain" [style.background-color]="'var(--missing, var(--surface))'"></view>
    <view testID="tinted" [style.color]="'var(--surface)'"><text testID="label">x</text></view>
    <view testID="switching" [style.background-color]="colour()"></view>
    <view testID="object" [style]="{ opacity: 'var(--fade)' }"></view>
  `,
  styles: `
    :host {
      --surface: rgb(1, 2, 3);
      --w: 40px;
      --fade: 0.5;
    }
  `,
})
export class BoundVars {
  readonly surface = signal<string | undefined>('rgb(4, 5, 6)');
  readonly colour = signal<string | undefined>('var(--surface)');
}
