import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { View } from '../../components/src/view.ts';

/** An outline, as heroicons ships one: its paint on the root, the stroke width in its style. */
const outline =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" ' +
  'aria-hidden="true" style="stroke-width:var(--ng-icon__stroke-width, 1.5)">' +
  '<path stroke-linecap="round" d="M4 10a6 6 0 0 0 0 6"/><path stroke-width="3" d="M1 1L2 2"/></svg>';

/** A shape in a colour of its own, which the engine translates. */
const filled = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="4" height="4" fill="red"/></svg>';

@Component({
  selector: 'x-icon-restyle',
  imports: [NgIcon, View],
  template: `
    <view style="color: rgb(1, 2, 3); font-size: 18px">
      <ng-icon
        nativeID="outline"
        [svg]="outline"
        [size]="size()"
        [color]="colour()"
        [strokeWidth]="weight()"
      />
      <ng-icon nativeID="filled" [svg]="filled" />
      <ng-icon nativeID="swapped" [svg]="swapped()" />
    </view>
  `,
})
export class IconRestyle {
  readonly outline = outline;
  readonly filled = filled;
  readonly size = signal(24);
  readonly colour = signal('#ff9f0a');
  readonly weight = signal<number | undefined>(undefined);
  readonly swapped = signal(outline);
}
