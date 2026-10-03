import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { View } from '../../components/src/view.ts';

/** Icons whose own markup takes a colour from a custom property, as a style and as an attribute. */
@Component({
  selector: 'x-icon-tokens',
  imports: [NgIcon, View],
  template: `
    <view [style.--brand]="brand()">
      <ng-icon nativeID="styled" [svg]="styled" />
      <ng-icon nativeID="attribute" [svg]="attribute" />
    </view>
    <ng-icon nativeID="fallback" [svg]="fallback" />
    <ng-icon nativeID="unset" [svg]="unset" />
  `,
})
export class IconTokens {
  readonly brand = signal<string | undefined>('rgb(1, 2, 3)');
  readonly styled =
    '<svg viewBox="0 0 10 10"><path d="M0 0L5 5" style="stroke: var(--brand)"/></svg>';
  readonly attribute =
    '<svg viewBox="0 0 10 10"><path d="M0 0L5 5" fill="var(--brand)" stroke="red"/></svg>';
  readonly fallback =
    '<svg viewBox="0 0 10 10"><path d="M0 0L5 5" stroke="var(--missing, rgb(7, 8, 9))"/></svg>';
  readonly unset = '<svg viewBox="0 0 10 10"><path d="M0 0L5 5" stroke="var(--nowhere)"/></svg>';
}
