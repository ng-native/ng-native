import { Component, input, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-deep-kid',
  imports: [View],
  template: `<view
    class="inner mark"
    [class.lit]="lit()"
    [attr.testID]="'inner-' + name()"
  ></view>`,
})
export class DeepKid {
  readonly name = input('');
  readonly lit = input(false);
}

@Component({
  selector: 'x-deep-frame',
  imports: [DeepKid, View],
  template: `
    <view class="wrap"><x-deep-kid name="a" [lit]="lit()" /></view>
    <view class="plain"><x-deep-kid name="b" /></view>
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
    /* An anchor is an element of the frame's own view: not its host, whatever class that is given. */
    .framed ::ng-deep .inner {
      margin-left: 5px;
    }
    /* And so is everything written before it: an .outer above the frame is none of its own. */
    .outer .wrap ::ng-deep .inner {
      margin-right: 6px;
    }
    /* The frame's own, with no piercing: a kid's elements are not its to style. */
    .mark {
      margin-top: 9px;
    }
  `,
})
export class DeepFrame {
  readonly lit = signal(false);
}

@Component({
  selector: 'x-deep-page',
  imports: [DeepFrame, DeepKid, View],
  template: `
    <view class="outer"><x-deep-frame class="framed" /></view>
    <x-deep-kid name="c" />
  `,
})
export class DeepPage {}
