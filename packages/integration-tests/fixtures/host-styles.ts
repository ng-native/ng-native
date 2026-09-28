import { Component, input, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-host-kid',
  template: `<text class="label">kid</text>`,
  styles: `
    :host {
      background-color: rgb(1, 1, 1);
    }
    :host(.active) {
      background-color: rgb(2, 2, 2);
    }
    :host .label {
      color: rgb(3, 3, 3);
    }
    :host-context(.dark) .label {
      letter-spacing: 4px;
    }
    /* For the kid's own elements: the parent's class="active" on the host must not pick it up. */
    .active {
      padding: 9px;
    }
  `,
})
export class HostKid {
  readonly active = input(false);
}

@Component({
  selector: 'x-host-parent',
  imports: [HostKid, Text, View],
  template: `
    <view class="wrap" [class.dark]="dark()">
      <x-host-kid />
      <x-host-kid class="active" />
    </view>
  `,
  styles: `
    .wrap {
      padding: 3;
    }
  `,
})
export class HostParent {
  readonly dark = signal(false);
}
