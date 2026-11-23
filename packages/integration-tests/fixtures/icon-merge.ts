import { Component } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';

/** A path and a circle in one stroke, with no fill, as an outline set draws them. */
const outline =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">' +
  '<path d="M1 1L2 2"/><circle cx="5" cy="5" r="1"/></svg>';

@Component({
  selector: 'x-icon-merge',
  imports: [NgIcon],
  template: `<ng-icon nativeID="icon" [svg]="outline" />`,
})
export class IconMerge {
  readonly outline = outline;
}
