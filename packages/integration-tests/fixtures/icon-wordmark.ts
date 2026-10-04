import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';

/** A wordmark filled with a gradient: defs, a gradient with stops, and text that references it. */
export const WORDMARK =
  '<svg viewBox="0 0 96 24"><title>Week</title><defs>' +
  '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#437dfc" /><stop offset="1" stop-color="#4ad0ef" />' +
  '</linearGradient></defs>' +
  '<text x="0" y="18" font-size="17" font-weight="600" fill="url(#g)">Week</text></svg>';

/** A stop in the icon's own colour, and an element no native view draws. */
export const TINTED =
  '<svg viewBox="0 0 24 24"><defs><radialGradient id="r">' +
  '<stop offset="0%" stop-color="currentColor" /><stop offset="100%" stop-color="#000000" stop-opacity="0" />' +
  '</radialGradient></defs><mask id="a" /><mask id="b" /><circle cx="12" cy="12" r="10" fill="url(#r)" /></svg>';

@Component({
  selector: 'x-wordmark-host',
  imports: [NgIcon],
  template: `
    <ng-icon nativeID="mark" [svg]="mark" style="width: 96px; height: 24px" />
    <ng-icon nativeID="tinted" [svg]="tinted" [color]="tint()" />
    <ng-icon nativeID="untinted" [svg]="tinted" />
  `,
})
export class WordmarkHost {
  readonly mark = WORDMARK;
  readonly tinted = TINTED;
  readonly tint = signal('#ff0000');
}
