import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';

/** An icon drawn from markup the app was given, which it can change. */
@Component({
  selector: 'x-icon-markup-host',
  imports: [NgIcon],
  template: `<ng-icon nativeID="given" [svg]="markup()" />`,
})
export class IconMarkupHost {
  readonly markup = signal('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>');
}
