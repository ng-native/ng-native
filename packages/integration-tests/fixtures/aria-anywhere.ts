import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** A component of an app's own: its host commits a view, with none of the primitives' inputs. */
@Component({ selector: 'x-tags', template: '<ng-content />' })
export class Tags {}

@Component({
  selector: 'x-aria-anywhere',
  imports: [Tags, View],
  template: `
    <view testID="row" role="row"></view>
    <view testID="item" role="listitem" aria-label="First"></view>
    <view testID="legacy" role="header"></view>
    <view testID="both" role="listitem" accessibilityRole="button"></view>
    <x-tags testID="host" role="list" aria-label="Tags" aria-live="polite"></x-tags>
    <x-tags testID="hidden" aria-hidden="true"></x-tags>
    <x-tags
      testID="state"
      aria-disabled="true"
      aria-checked="mixed"
      aria-valuenow="3"
      aria-valuemax="10"
      [attr.aria-label]="label()"
    ></x-tags>
    <x-tags testID="own" aria-label="Aria" accessibilityLabel="Own"></x-tags>
    <x-tags testID="unread" aria-valuenow="abc" aria-valuemax=""></x-tags>
  `,
})
export class AriaAnywhere {
  readonly label = signal<string | undefined>('Bound');
}
