import { Component } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** A transform bound on views that a class also turns, with values Chrome reads and rejects. */
@Component({
  imports: [View],
  selector: 'x-inline-transform',
  styles: ['.turned { transform: rotate(45deg); }'],
  template: `
    @for (entry of entries; track entry.id) {
      <view
        [nativeID]="entry.id"
        [class.turned]="entry.turned"
        [style.transform]="entry.value"
      ></view>
    }
  `,
})
export class InlineTransform {
  protected readonly entries = [
    { id: 'class-only', turned: true, value: null },
    { id: 'nbsp-argument', turned: true, value: 'rotate( 90deg)' },
    { id: 'nbsp-argument-alone', turned: false, value: 'rotate( 90deg)' },
    { id: 'nbsp-none', turned: true, value: ' none' },
    { id: 'junk-after', turned: true, value: 'rotate(90deg) junk' },
    { id: 'nbsp-between', turned: true, value: 'rotate(90deg) scale(2)' },
    { id: 'valid', turned: true, value: 'rotate(90deg)' },
    { id: 'padded', turned: true, value: ' \trotate(90deg)\n' },
    { id: 'none', turned: true, value: 'none' },
    { id: 'upper-none', turned: true, value: 'NONE' },
    { id: 'comma', turned: true, value: 'translate(4px, 8px)' },
    { id: 'upper', turned: true, value: 'ROTATE(90deg)' },
    { id: 'mixed', turned: true, value: 'TranslateX(4px)' },
    { id: 'unknown', turned: true, value: 'spin(90deg)' },
    { id: 'third-axis', turned: true, value: 'scale3d(0, 0.5, 0) translate3d(4px, 8px, 0)' },
    { id: 'along-z', turned: true, value: 'translate3d(4px, 8px, 2px)' },
    { id: 'zero-z-unit', turned: true, value: 'translate3d(4px, 8px, 0em)' },
    { id: 'one-of-three', turned: true, value: 'scale3d(2)' },
    { id: 'two-of-three', turned: true, value: 'translate3d(4px, 8px)' },
    { id: 'unspaced', turned: true, value: 'translate(4px,8px)rotate(90deg)' },
    { id: 'separators', turned: true, value: 'translate( 4px ,\t8px ) scale(2)' },
    { id: 'math', turned: true, value: 'translate(calc(2px + 2px), 8px) rotate(calc(45deg * 2))' },
    { id: 'fractions', turned: true, value: 'translateX(-.5px) rotate(.5turn)' },
    { id: 'spelt', turned: true, value: 'translateX(+4PX) translateY(1e1px) scale(1E-1)' },
    { id: 'empty-argument', turned: true, value: 'rotate( , )' },
    { id: 'left-open', turned: true, value: 'translate(4px, 8px) rotate(90deg' },
  ];
}
