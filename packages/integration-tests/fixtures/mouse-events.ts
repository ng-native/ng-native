import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-mouse-events',
  imports: [View],
  template: `
    <view
      testID="box"
      (mouseenter)="log('mouseenter')"
      (mouseleave)="log('mouseleave')"
      (mousemove)="log('mousemove')"
      (mouseover)="log('mouseover')"
      (mouseout)="log('mouseout')"
      (dblclick)="log('dblclick')"
      (contextmenu)="log('contextmenu')"
      (wheel)="log('wheel')"
    ></view>
  `,
})
export class MouseEvents {
  readonly heard = signal<string[]>([]);
  log(name: string): void {
    this.heard.update((all) => [...all, name]);
  }
}
