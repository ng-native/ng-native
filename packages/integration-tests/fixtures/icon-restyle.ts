import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { View } from '../../components/src/view.ts';

/** An outline, as heroicons ships one: its paint on the root, the stroke width in its style. */
const outline =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" ' +
  'aria-hidden="true" style="stroke-width:var(--ng-icon__stroke-width, 1.5)">' +
  '<path stroke-linecap="round" d="M4 10a6 6 0 0 0 0 6"/><path stroke-width="3" d="M1 1L2 2"/></svg>';

/** A root whose group draws what its children would draw one by one: an opacity over both. */
const faded =
  '<svg viewBox="0 0 24 24" fill="currentColor" opacity="0.5">' +
  '<circle cx="8" cy="8" r="6"/><circle cx="12" cy="12" r="6"/></svg>';

/** A root with a label and a size in its style: the label draws nothing, and the size is not paint. */
const titled =
  '<svg viewBox="0 0 24 24" fill="red" style="width:24px;height:24px">' +
  '<title>Box</title><rect x="2" y="2"/></svg>';

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
      <ng-icon nativeID="faded" [svg]="faded" />
      <ng-icon nativeID="titled" [svg]="titled" />
      <ng-icon nativeID="swapped" [svg]="swapped()" />
    </view>
  `,
})
export class IconRestyle {
  readonly outline = outline;
  readonly faded = faded;
  readonly titled = titled;
  readonly size = signal(24);
  readonly colour = signal('#ff9f0a');
  readonly weight = signal<number | undefined>(undefined);
  readonly swapped = signal(outline);
}
