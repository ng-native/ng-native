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
    <view [class]="tone()">
      <ng-icon nativeID="css" [svg]="outline" />
      <ng-icon nativeID="filled" [svg]="filled" />
      <ng-icon nativeID="red" [svg]="red" />
    </view>
  `,
})
export class IconColours {
  readonly outline = outline;
  /** Two shapes with a fill, which never merge, in whatever colour. */
  /** Two shapes stroked in a colour of their own, which merge in whatever colour the icon is. */
  readonly red =
    '<svg viewBox="0 0 24 24" fill="none" stroke="red"><path d="M1 1L9 9"/><path d="M9 1L1 9"/></svg>';
  readonly filled =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 1h4v4H1z"/><path d="M6 6h4v4H6z"/></svg>';
  readonly colour = signal('rgba(0, 0, 0, 0.5)');
  readonly tone = signal('faint');
}
