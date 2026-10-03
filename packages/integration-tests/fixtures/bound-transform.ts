import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** One transform bound as a style and one set by a class, under the same transition. */
@Component({
  selector: 'x-slide',
  imports: [View],
  template: `
    <view
      testID="bound"
      class="box"
      [style.transform]="'translateX(' + (on() ? 100 : 0) + 'px)'"
    ></view>
    <view testID="ruled" class="box" [class.on]="on()"></view>
  `,
  styles: `
    .box {
      transform: translateX(0px);
      transition: transform 300ms linear;
    }
    .box.on {
      transform: translateX(100px);
    }
  `,
})
export class Slide {
  readonly on = signal(false);
}
