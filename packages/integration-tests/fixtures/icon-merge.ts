import { Component, signal } from '@angular/core';
import { NgIcon } from '../../icons/src/ng-icon.ts';
import { View } from '../../components/src/view.ts';

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

/**
 * The same icon coloured each way an app colours one: its input, and a stylesheet's colour it
 * inherits, which the engine settles only once it commits.
 */
@Component({
  selector: 'x-icon-colours',
  imports: [NgIcon, View],
  styles: `
    .faint {
      color: rgba(0, 0, 0, 0.5);
    }
    .solid {
      color: rgb(0, 0, 255);
    }
  `,
  template: `
    <ng-icon nativeID="input" [svg]="outline" [color]="colour()" />
    <view [class]="tone()"><ng-icon nativeID="css" [svg]="outline" /></view>
  `,
})
export class IconColours {
  readonly outline = outline;
  readonly colour = signal('rgba(0, 0, 0, 0.5)');
  readonly tone = signal('faint');
}
