import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** A component of an app's own: its host commits a view, with none of the primitives' inputs. */
@Component({ selector: 'x-heading', template: '<ng-content />' })
export class Heading {}

@Component({
  selector: 'x-accessibility-desktop-inputs',
  imports: [Heading, View],
  template: `
    <view
      testID="native"
      accessibilityLevel="2"
      [accessibilityDescribedBy]="['hint', 'error']"
      [accessibilityRequired]="true"
      [accessibilityInvalid]="invalid()"
      accessibilityPosInSet="3"
      accessibilitySetSize="10"
      accessibilityRowCount="5"
      accessibilityColumnCount="4"
    ></view>
    <view
      testID="web"
      aria-level="2"
      aria-describedby="hint, error"
      aria-required="true"
      aria-invalid="true"
      aria-posinset="3"
      aria-setsize="10"
      aria-rowcount="5"
      aria-colcount="4"
    ></view>
    <view testID="both" accessibilityLevel="1" aria-level="3"></view>
    <x-heading
      testID="host"
      aria-level="2"
      aria-describedby="hint"
      aria-required="true"
      aria-invalid="false"
      aria-posinset="1"
      aria-setsize="2"
      aria-rowcount="7"
      aria-colcount="3"
    ></x-heading>
  `,
})
export class AccessibilityDesktopInputs {
  readonly invalid = signal(true);
}
