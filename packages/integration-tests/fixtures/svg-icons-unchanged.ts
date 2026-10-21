import { Component } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/**
 * Icons as an app draws them today, in a view whose text style and paint every child inherits:
 * a stroked outline, a filled glyph, a root paint from a token over a group with its own, and a
 * text. What they commit is pinned against the drawing support an `<svg>` of a library opts in to.
 */
@Component({
  selector: 'x-svg-icons-unchanged',
  imports: [NgIcon, Text, View],
  template: `
    <view
      style="font-size: 18px; font-weight: 700; color: rgb(4, 5, 6); padding: 4px; --brand: rgb(1, 2, 3)"
    >
      <text>Label</text>
      <ng-icon nativeID="outline" [svg]="outline" />
      <ng-icon nativeID="glyph" [svg]="glyph" color="rgb(9, 9, 9)" />
      <ng-icon nativeID="token" [svg]="token" />
      <ng-icon nativeID="words" [svg]="words" />
    </view>
  `,
})
export class SvgIconsUnchanged {
  readonly outline =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M0 0L5 5"/><circle cx="4" cy="4" r="2" fill="red"/></svg>';
  readonly glyph = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1L6 6"/></svg>';
  readonly token =
    '<svg viewBox="0 0 24 24" stroke="var(--brand)"><g stroke="none" fill="blue"><path d="M2 2L7 7"/></g><path d="M3 3L8 8"/></svg>';
  readonly words =
    '<svg viewBox="0 0 24 24"><text x="1" y="10" font-size="8">Hi <tspan font-weight="bold">there</tspan></text></svg>';
}
