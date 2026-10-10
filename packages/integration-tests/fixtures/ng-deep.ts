import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-deep-kid',
  imports: [View],
  template: `<view class="inner mark" [class.lit]="lit()" [attr.testID]="'inner-' + name"></view>`,
})
export class DeepKid {
  static count = 0;
  readonly name = ++DeepKid.count;
  readonly lit = signal(false);
}

@Component({
  selector: 'x-deep-frame',
  imports: [DeepKid, View],
  template: `
    <view class="wrap"><x-deep-kid /></view>
    <view class="plain"><x-deep-kid /></view>
  `,
  styles: `
    :host ::ng-deep .inner {
      opacity: 0.5;
    }
    .wrap ::ng-deep .mark {
      padding-top: 7px;
    }
    :host ::ng-deep .inner.lit {
      opacity: 0.25;
    }
    /* The frame's own, with no piercing: a kid's elements are not its to style. */
    .mark {
      margin-top: 9px;
    }
  `,
})
export class DeepFrame {}

@Component({
  selector: 'x-deep-page',
  imports: [DeepFrame, DeepKid],
  template: `
    <x-deep-frame />
    <x-deep-kid />
  `,
})
export class DeepPage {}
