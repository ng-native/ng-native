import { Component, signal } from '@angular/core';
import { NativeHeader } from '../../router/src/native-header.ts';

/** What the header below binds as its subtitle, for a test to change. */
export const subtitle = signal<string | undefined>('3 waiting');

/** A header with a subtitle beside its title. */
@Component({
  imports: [NativeHeader],
  selector: 'x-header-subtitle',
  template: `<native-header title="Inbox" nativeID="bar" [subtitle]="subtitle()" />`,
})
export class HeaderSubtitle {
  protected readonly subtitle = subtitle;
}
