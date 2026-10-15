import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** A panel added to a screen already drawn, with a class bound to a signal. */
@Component({
  selector: 'x-bound-class',
  imports: [View],
  template: `
    @if (shown()) {
      <view class="panel" [class.filled]="filled()"></view>
    }
  `,
  styles: `
    .panel {
      background-color: rgb(0, 0, 0);
      transition: background-color 200ms linear;
    }

    .panel.filled {
      background-color: rgb(200, 100, 0);
    }
  `,
})
export class BoundClassPanel {
  readonly shown = signal(false);
  readonly filled = signal(false);
}
