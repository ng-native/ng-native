import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** Bound declarations in `em`, measured against the font size in scope, as a stylesheet's are. */
@Component({
  selector: 'x-bound-em',
  imports: [Text, View],
  template: `
    <view testID="plain" [style.width]="'2em'" [style.height]="'2em'"></view>
    <view testID="own" class="small" [style.width]="'2em'"></view>
    <view class="large"><view testID="inherited" [style.width]="'2em'"></view></view>
    <view class="large">
      <view testID="font" [style.font-size]="'1.5em'" [style.width]="'2em'"></view>
    </view>
    <view [style.font-size.px]="font()">
      <view testID="follows" [style.width]="'2em'"></view>
    </view>
    <view testID="switching" [style.width]="width()"></view>
    <view testID="object" [style]="{ width: '0.5em', marginTop: '1em' }"></view>
    <view testID="static" style="width: 1.5em; margin-top: 1em"></view>
    <text testID="line" [style.line-height]="'2em'">line</text>
    <view testID="grow" [style.flex-grow]="'2em'"></view>
    <view class="large">
      <view testID="rem" [style.width]="'2rem'" [style.margin-top.rem]="1.5"></view>
    </view>
    <view testID="rem-object" [style]="{ width: '0.5rem', marginTop: '1rem' }"></view>
    <view testID="rem-static" style="width: 1.5rem; margin-top: 1rem"></view>
  `,
  styles: `
    .small {
      font-size: 10px;
    }
    .large {
      font-size: 20px;
    }
  `,
})
export class BoundEm {
  readonly font = signal<number | undefined>(12);
  readonly width = signal<string | number | undefined>('3em');
}

/** Bound declarations in viewport units, beside the same four in a stylesheet. */
@Component({
  selector: 'x-bound-viewport',
  imports: [View],
  template: `
    <view testID="sheet" class="viewport"></view>
    <view
      testID="bound"
      [style.width]="'50vw'"
      [style.height]="'10vh'"
      [style.margin-top]="'5vmin'"
      [style.margin-left]="'5vmax'"
    ></view>
  `,
  styles: `
    .viewport {
      width: 50vw;
      height: 10vh;
      margin-top: 5vmin;
      margin-left: 5vmax;
    }
  `,
})
export class BoundViewport {}
