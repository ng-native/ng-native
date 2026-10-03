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
    <view
      testID="current"
      class="inked"
      [style.border-top-color]="'var(--missing, currentcolor)'"
    ></view>
    <view testID="kinds" [style.display]="'var(--d)'"></view>
  `,
  styles: `
    :host {
      --surface: rgb(1, 2, 3);
      --w: 40px;
      --fade: 0.5;
      --d: block;
    }
    .inked {
      color: rgb(3, 3, 3);
    }
  `,
})
export class BoundVars {
  readonly surface = signal<string | undefined>('rgb(4, 5, 6)');
  readonly colour = signal<string | undefined>('var(--surface)');
}

/** A bound declaration reading a token nothing defines, with nothing to fall back to. */
@Component({
  selector: 'x-unset',
  imports: [View],
  template: `<view [style.background-color]="'var(--nowhere)'"></view>`,
})
export class Unset {}
