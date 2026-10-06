import { type AfterViewInit, ChangeDetectorRef, Component, inject, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** A child that checks itself again as soon as its view is up, as a library's often does. */
@Component({
  selector: 'x-eager',
  imports: [Text],
  template: `<text>{{ label() }}</text>`,
})
export class Eager implements AfterViewInit {
  private readonly changes = inject(ChangeDetectorRef);
  readonly label = signal('first');

  ngAfterViewInit(): void {
    this.label.set('checked');
    this.changes.detectChanges();
  }
}

/** Eight of them, built in one pass. */
@Component({
  selector: 'x-nested-detect',
  imports: [Eager, Text, View],
  template: `
    <view>
      @for (n of rows; track n) {
        <x-eager />
      }
      <text>{{ count() }}</text>
    </view>
  `,
})
export class NestedDetect {
  readonly rows = [0, 1, 2, 3, 4, 5, 6, 7];
  readonly count = signal(0);
}
